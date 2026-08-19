export const config = { maxDuration: 30 };

const POLLINATIONS_ORIGIN = 'https://gen.pollinations.ai';
let cachedModel = null;
let modelCacheExpiresAt = 0;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function serverKey() {
  return String(process.env.POLLINATIONS_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

export function selectAssistModel(models = []) {
  const candidates = models.filter((model) => {
    const outputs = Array.isArray(model?.output_modalities) ? model.output_modalities : [];
    return model?.name && (!outputs.length || outputs.includes('text'));
  });
  return candidates
    .map((model) => {
      const description = String(model.description || '').toLowerCase();
      let score = 0;
      if (/cod(e|ing)|developer|agentic/.test(description)) score += 5;
      if (/fast|flash|compact|small|low-cost|affordable/.test(description)) score += 4;
      if (model.tools) score += 1;
      if (model.reasoning) score += 1;
      return { model, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.model?.name || '';
}

async function assistModel(key, signal) {
  if (Date.now() < modelCacheExpiresAt) return cachedModel;
  try {
    const response = await fetch(`${POLLINATIONS_ORIGIN}/text/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
      cache: 'no-store',
    });
    const models = response.ok ? await response.json() : [];
    cachedModel = selectAssistModel(Array.isArray(models) ? models : []);
  } catch {
    cachedModel = '';
  }
  modelCacheExpiresAt = Date.now() + 10 * 60 * 1000;
  return cachedModel;
}

function cleanSuggestion(value, maxLength) {
  return String(value || '')
    .replace(/^```[^\n]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^(?:suggestion|completion|answer):\s*/i, '')
    .slice(0, maxLength)
    .trimEnd();
}

function completionPrompt({ path, language, prefix, suffix }) {
  return [
    `File: ${path || 'untitled'}`,
    `Language: ${language || 'text'}`,
    'Insert code exactly at <CURSOR>. Return only the missing code, with no markdown or explanation.',
    'Preserve local style and avoid repeating text already present.',
    '<BEFORE>',
    prefix,
    '</BEFORE>',
    '<CURSOR>',
    '<AFTER>',
    suffix,
    '</AFTER>',
  ].join('\n');
}

function reviewPrompt({ diff, status, kind }) {
  const instruction = kind === 'commit'
    ? 'Write one conventional, imperative Git commit subject under 72 characters. Return only the subject.'
    : 'Write a concise GitHub pull-request or review summary with a short heading, key changes, and validation. Return markdown only.';
  return `${instruction}\n\nGit status:\n${status}\n\nDiff:\n${diff}`;
}

export async function POST(request) {
  const key = serverKey();
  if (!key) return json({ error: 'Code assistance is not configured.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON request.' }, 400); }
  const task = String(body?.task || 'completion');
  if (!['completion', 'github-comment', 'commit'].includes(task)) {
    return json({ error: 'Unsupported code-assistance task.' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  const abort = () => controller.abort();
  request.signal?.addEventListener?.('abort', abort, { once: true });
  try {
    const model = await assistModel(key, controller.signal);
    const prompt = task === 'completion'
      ? completionPrompt({
        path: String(body.path || '').slice(0, 500),
        language: String(body.language || '').slice(0, 80),
        prefix: String(body.prefix || '').slice(-10_000),
        suffix: String(body.suffix || '').slice(0, 4_000),
      })
      : reviewPrompt({
        diff: String(body.diff || '').slice(0, 24_000),
        status: String(body.status || '').slice(0, 4_000),
        kind: task,
      });
    const payload = {
      messages: [
        { role: 'system', content: 'You are a fast, precise coding copilot. Follow the output contract exactly and never expose credentials.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: task === 'completion' ? 220 : 320,
      temperature: 0.15,
      ...(model ? { model } : {}),
    };
    const response = await fetch(`${POLLINATIONS_ORIGIN}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: 'The coding assistant is temporarily unavailable.' }, 502);
    const suggestion = cleanSuggestion(result?.choices?.[0]?.message?.content, task === 'completion' ? 4_000 : 6_000);
    if (!suggestion) return json({ error: 'The coding assistant returned no suggestion.' }, 502);
    return json({ suggestion });
  } catch (error) {
    return json({ error: error?.name === 'AbortError' ? 'The coding assistant timed out.' : 'The coding assistant is unavailable.' }, 503);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener?.('abort', abort);
  }
}

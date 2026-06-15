export const config = { maxDuration: 60 };

const OLLAMA_API_URL = (process.env.OLLAMA_API_URL || 'http://147.93.102.103:11434/api/generate').trim();
const OLLAMA_TEXT_MODEL = (process.env.OLLAMA_TEXT_MODEL || 'huihui_ai/deepseek-r1-abliterated:14b').trim();
const OLLAMA_VISION_MODEL = (process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 2048);
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 300000);

// Hard caps to prevent DoS / runaway requests.
const MAX_BODY_BYTES = 5 * 1024 * 1024;        // 5 MB request body
const MAX_MESSAGES = 40;                        // history depth
const MAX_TEXT_CONTENT_CHARS = 24_000;          // total chars across a single message
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 8192;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

function toOllamaPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || 'user').toUpperCase();
      const content = typeof message?.content === 'string' ? message.content : String(message?.content || '');
      return `${role}: ${content}`;
    })
    .join('\n\n')
    .trim();
}

function imageToOllamaBase64(image) {
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return null;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    return comma >= 0 ? raw.slice(comma + 1) : null;
  }
  return raw;
}

function extractLastUserImages(messages = [], fallbackImages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'user') continue;
    const list = Array.isArray(messages[i].images) ? messages[i].images : [];
    const converted = list.map((img) => imageToOllamaBase64({ data: img })).filter(Boolean);
    if (converted.length) return converted;
  }
  return (Array.isArray(fallbackImages) ? fallbackImages : [])
    .map(imageToOllamaBase64)
    .filter(Boolean);
}

function normalizeMessages(messages = [], systemPrompt) {
  const list = Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [];
  const normalized = list
    .filter((message) => message?.role && message.content != null)
    .map((message) => {
      const role = ALLOWED_ROLES.has(message.role) ? message.role : 'user';
      const content = typeof message.content === 'string'
        ? message.content.slice(0, MAX_TEXT_CONTENT_CHARS)
        : String(message.content || '').slice(0, MAX_TEXT_CONTENT_CHARS);
      return { role, content };
    });

  if (systemPrompt && typeof systemPrompt === 'string') {
    return [
      { role: 'system', content: systemPrompt.slice(0, MAX_TEXT_CONTENT_CHARS) },
      ...normalized.filter((message) => message.role !== 'system'),
    ];
  }
  return normalized;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOllamaWithRetry(payload) {
  const transientStatus = new Set([408, 429, 500, 502, 503, 504]);
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const upstream = await fetch(OLLAMA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (upstream.ok) return upstream;

      const errorText = await upstream.text().catch(() => '');
      lastError = { status: upstream.status, message: errorText || `Ollama upstream error (${upstream.status}).` };
      if (transientStatus.has(upstream.status) && attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }

      return jsonResponse({ error: `Ollama upstream error (${upstream.status}).` }, upstream.status);
    } catch (err) {
      clearTimeout(timeout);
      const message = err?.name === 'AbortError' ? 'Ollama request timed out.' : (err?.message || 'Chat request failed.');
      lastError = { status: 500, message };
      if (attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }
    }
  }

  return jsonResponse({ error: lastError?.message || 'Chat request failed.' }, lastError?.status || 500);
}

export async function POST(req) {
  try {
    // Enforce request body size cap.
    const lengthHeader = Number(req.headers.get?.('content-length') || 0);
    if (lengthHeader && lengthHeader > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large.' }, 413);
    }

    const body = await req.json();
    const imageList = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    const messages = normalizeMessages(body.messages, body.systemPrompt);

    if (messages.length === 0) {
      return jsonResponse({ error: 'At least one chat message is required.' }, 400);
    }

    const requestedMax = Number(body.max_tokens) || OLLAMA_MAX_TOKENS;
    const safeMax = Math.max(1, Math.min(requestedMax, MAX_TOKENS_CAP));
    const prompt = toOllamaPrompt(messages);
    const promptImages = extractLastUserImages(messages, imageList);
    const hasImages = promptImages.length > 0;
    const effectiveModel = hasImages ? OLLAMA_VISION_MODEL : OLLAMA_TEXT_MODEL;
    if (!OLLAMA_API_URL) return jsonResponse({ error: 'OLLAMA_API_URL is not configured.' }, 500);

    const upstreamOrResponse = await fetchOllamaWithRetry({
      model: effectiveModel,
      prompt,
      ...(hasImages ? { images: promptImages } : {}),
      stream: body.stream !== false,
      options: { num_predict: safeMax },
    });

    if (!upstreamOrResponse.ok) {
      return upstreamOrResponse;
    }
    const upstream = upstreamOrResponse;

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Chat API error:', err?.message);
    const message = err.name === 'AbortError' ? 'Ollama request timed out.' : 'Chat request failed.';
    return jsonResponse({ error: message }, 500);
  }
}
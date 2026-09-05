import { formSearchQuery } from './_searchQuery.js';
import { guardRequest } from './_requestSecurity.js';
import { requestDeepSeekChat } from './code-assist.js';

export const config = { maxDuration: 30 };

const MIRA_PLANNER_ATTEMPTS = 2;
const MIRA_PLANNER_TIMEOUT_MS = 3_000;
const MIRA_PLANNER_RETRY_DELAY_MS = 150;
const DEEPSEEK_PLANNER_TIMEOUT_MS = 3_000;

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^```(?:text)?|```$/gi, '')
    .replace(/^(?:query|search query)\s*:\s*/i, '')
    .replace(/^[-*\s"'`]+|[-*\s"'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function requestDeepSeekQuery({ latestMessage, context, signal }) {
  const result = await requestDeepSeekChat({
    messages: [{ role: 'user', content: plannerPrompt({ latestMessage, context }) }],
    systemPrompt: 'You are a concise search-query planner for MIRA.',
    maxTokens: 256,
    think: false,
    signal,
  });
  return cleanQuery(result.answer || '');
}

function plannerPrompt({ latestMessage, context }) {
  return [
    'Create one search-engine-ready web query for MIRA.',
    'Resolve pronouns and follow-up phrases from the supplied conversation context.',
    'Preserve identity constraints such as full name, city, profession, company, platform, date, and requested fact.',
    'Prefer the specific entity from the immediately preceding exchange over generic words in the latest message.',
    'Return only the concise query text with no explanation, label, Markdown, quotes, or tool syntax.',
    `LATEST MESSAGE:\n${latestMessage}`,
    `CONVERSATION CONTEXT:\n${context || '(none)'}`,
  ].join('\n\n');
}

function parseMiraPlannerResponse(text = '') {
  let answer = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'data: [DONE]') continue;
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
    try {
      const parsed = JSON.parse(payload);
      answer += parsed?.choices?.[0]?.delta?.content
        || parsed?.choices?.[0]?.message?.content
        || parsed?.message?.content
        || '';
    } catch {
      // Ignore keep-alives and non-JSON SSE metadata.
    }
  }
  return cleanQuery(answer);
}

function miraPlannerConfig() {
  const baseUrl = String(process.env.MIRA_BASE_URL || '').trim().replace(/\/+$/, '');
  const openAiBaseUrl = String(
    process.env.MIRA_OPENAI_BASE_URL || (baseUrl ? `${baseUrl}/v1` : ''),
  ).trim().replace(/\/+$/, '');
  return {
    apiUrl: openAiBaseUrl ? `${openAiBaseUrl}/chat/completions` : '',
    apiKey: String(process.env.MIRA_API_TOKEN || '').trim(),
    model: String(process.env.MIRA_CHAT_MODEL || 'MIRA:latest').trim(),
  };
}

function isRetryablePlannerError(error) {
  const status = Number(error?.status || 0);
  return error instanceof TypeError
    || error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || ['mira_planner_empty', 'mira_planner_timeout', 'mira_planner_invalid'].includes(error?.code)
    || [408, 425, 429].includes(status)
    || status >= 500;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function withTimeout(parentSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return typeof AbortSignal.any === 'function' && parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
}

async function requestMiraQuery({ latestMessage, context, signal }) {
  const { apiUrl, apiKey, model } = miraPlannerConfig();
  if (!apiUrl || !apiKey) {
    const error = new Error('MIRA query planning is not configured.');
    error.code = 'mira_planner_not_configured';
    throw error;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'ngrok-skip-browser-warning': '1',
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0,
      max_tokens: 128,
      messages: [
        { role: 'system', content: 'You are MIRA\'s precise contextual web-search query planner.' },
        { role: 'user', content: plannerPrompt({ latestMessage, context }) },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const error = new Error(`MIRA query planning failed (${response.status}).`);
    error.status = response.status;
    error.code = 'mira_planner_upstream';
    throw error;
  }

  const query = parseMiraPlannerResponse(await response.text());
  if (!query) {
    const error = new Error('MIRA returned an empty search query.');
    error.code = 'mira_planner_empty';
    throw error;
  }
  return query;
}

async function requestMiraQueryWithRetry({ latestMessage, context, signal }) {
  let lastError;
  for (let attempt = 1; attempt <= MIRA_PLANNER_ATTEMPTS; attempt += 1) {
    try {
      return await requestMiraQuery({
        latestMessage,
        context,
        signal: withTimeout(signal, MIRA_PLANNER_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (!isRetryablePlannerError(error) || attempt === MIRA_PLANNER_ATTEMPTS) throw error;
      await wait(MIRA_PLANNER_RETRY_DELAY_MS, signal);
    }
  }
  throw lastError;
}

export async function POST(req) {
  const blocked = guardRequest(req, { limit: 40, windowMs: 60_000, key: 'search-query' });
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const latestMessage = String(body?.latestMessage || '').trim().slice(0, 2_000);
    const context = String(body?.context || '').trim().slice(0, 8_000);
    const fallback = await formSearchQuery({
      latestMessage: body?.latestMessage,
      context: body?.context,
    });
    if (!latestMessage) {
      return Response.json({ query: '', source: 'empty' });
    }

    let query = cleanQuery(fallback?.query);
    let source = 'deterministic-fallback';
    let miraError = null;
    try {
      const aiQuery = await requestMiraQueryWithRetry({
        latestMessage,
        context,
        signal: req.signal,
      });
      if (aiQuery) {
        query = aiQuery;
        source = 'mira';
      }
    } catch (error) {
      miraError = error;
    }

    // DeepSeek is an outage-only fallback. Missing/invalid MIRA configuration
    // is surfaced through the deterministic planner rather than silently
    // routing ordinary traffic to another model.
    if (
      source !== 'mira'
      && isRetryablePlannerError(miraError)
      && String(process.env.DEEPSEEK_API_KEY || '').trim()
    ) {
      try {
        const aiQuery = await requestDeepSeekQuery({
          latestMessage,
          context,
          signal: withTimeout(req.signal, DEEPSEEK_PLANNER_TIMEOUT_MS),
        });
        if (aiQuery) {
          query = aiQuery;
          source = 'deepseek-fallback';
        }
      } catch {
        // Search still has the deterministic contextual query below.
      }
    }

    return new Response(JSON.stringify({ query, source }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || 'Could not form search query.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

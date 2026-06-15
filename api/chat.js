export const config = { maxDuration: 60 };

const SALAD_API_URL = process.env.SALAD_API_URL || process.env.API_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY || process.env.API_KEY;
const SALAD_MODEL = process.env.SALAD_MODEL || 'llama3.2';
const SALAD_VISION_MODEL = process.env.SALAD_VISION_MODEL || 'llama3.2-vision';
const SALAD_MAX_TOKENS = Number(process.env.SALAD_MAX_TOKENS || 2048);
const SALAD_TIMEOUT_MS = Number(process.env.SALAD_TIMEOUT_MS || 55000);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS || 25000);

// Hard caps to prevent DoS / runaway requests.
const MAX_BODY_BYTES = 5 * 1024 * 1024;        // 5 MB request body
const MAX_MESSAGES = 40;                        // history depth
const MAX_TEXT_CONTENT_CHARS = 24_000;          // total chars across a single message
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 8192;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

function splitKeys(value = '') {
  return String(value || '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const GEMINI_API_KEYS = [...new Set([
  process.env.GEMINI_API_KEY,
  ...splitKeys(process.env.GEMINI_API_KEYS),
])].filter(Boolean);

const GROQ_API_KEYS = [...new Set([
  process.env.GROQ_API_KEY,
  ...splitKeys(process.env.GROQ_API_KEYS),
])].filter(Boolean);

function candidateChatUrls(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) return [];

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return [value];
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const hasExplicitChatPath = /chat\/completions/i.test(cleanPath);
  const looksLikeRoot = cleanPath === '' || cleanPath === '/';

  const urls = [parsed.toString()];
  if (!hasExplicitChatPath) {
    urls.push(new URL('/api/v1/chat/completions', parsed.origin).toString());
    urls.push(new URL('/v1/chat/completions', parsed.origin).toString());
    if (looksLikeRoot) {
      urls.push(new URL('/chat/completions', parsed.origin).toString());
    } else if (/\/api\/v1$/i.test(cleanPath)) {
      urls.push(new URL('/api/v1/chat/completions', parsed.origin).toString());
    } else if (/\/v1$/i.test(cleanPath)) {
      urls.push(new URL('/v1/chat/completions', parsed.origin).toString());
    }
  }

  return [...new Set(urls)];
}

async function fetchChatUpstream(urls, init) {
  let lastResponse = null;
  for (let index = 0; index < urls.length; index += 1) {
    const response = await fetch(urls[index], init);
    if (response.ok || response.status !== 404 || index === urls.length - 1) return response;
    lastResponse = response;
  }
  return lastResponse;
}

function getEndpoint404Guidance(chatUrls = []) {
  const tried = Array.isArray(chatUrls) && chatUrls.length
    ? ` Tried: ${chatUrls.join(', ')}`
    : '';
  return `Chat upstream endpoint not found (404). Verify SALAD_API_URL in .env from Salad portal (do not use local-style paths like /api/chat).${tried}`;
}

function withTimeoutController(timeoutMs = FALLBACK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

function toFallbackPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || 'user').toUpperCase();
      const content = typeof message?.content === 'string' ? message.content : String(message?.content || '');
      return `${role}: ${content}`;
    })
    .join('\n\n')
    .trim();
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => String(part?.text || '')).join('').trim();
}

async function tryGeminiFallback(messages, maxTokens) {
  if (!GEMINI_API_KEYS.length) return null;
  const prompt = toFallbackPrompt(messages);
  if (!prompt) return null;

  for (const key of GEMINI_API_KEYS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
    const timeout = withTimeoutController();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: Math.min(maxTokens || 1024, 2048) },
        }),
        signal: timeout.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      const text = extractGeminiText(payload);
      if (text) return { provider: `gemini:${GEMINI_MODEL}`, text };
    } catch {
      // Try the next key.
    } finally {
      timeout.done();
    }
  }
  return null;
}

async function tryGroqFallback(messages, maxTokens) {
  if (!GROQ_API_KEYS.length) return null;
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => ALLOWED_ROLES.has(message?.role))
    .map((message) => ({ role: message.role, content: typeof message.content === 'string' ? message.content : String(message.content || '') }));
  if (!safeMessages.length) return null;

  for (const key of GROQ_API_KEYS) {
    const timeout = withTimeoutController();
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: safeMessages,
          stream: false,
          max_tokens: Math.min(maxTokens || 1024, 4096),
        }),
        signal: timeout.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      const text = String(payload?.choices?.[0]?.message?.content || '').trim();
      if (text) return { provider: `groq:${GROQ_MODEL}`, text };
    } catch {
      // Try the next key.
    } finally {
      timeout.done();
    }
  }
  return null;
}

async function tryProviderFallbacks(messages, maxTokens) {
  const gemini = await tryGeminiFallback(messages, maxTokens);
  if (gemini) return gemini;
  return tryGroqFallback(messages, maxTokens);
}

function imageToDataUrl(image) {
  // Kept for potential future OpenAI-style multimodal use; not used by the
  // Ollama vision path below.
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw) return null;
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `data:${image?.mimeType || image?.type || 'image/jpeg'};base64,${raw}`;
}
void imageToDataUrl;

// Ollama/llama3.2-vision expects per-message `images: [base64, ...]` with the
// raw base64 only (no `data:image/...;base64,` prefix). Normalize anything we
// receive (data URL, raw base64, http(s) URL won't work for Ollama — skip).
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

function attachImagesToLastUserMessage(messages, images) {
  if (!Array.isArray(images) || images.length === 0) return messages;
  const base64List = images.map(imageToOllamaBase64).filter(Boolean);
  if (base64List.length === 0) return messages;
  const copy = messages.map((m) => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'user') {
      copy[i] = { ...copy[i], images: base64List };
      return copy;
    }
  }
  // No user message found — append one carrying the images.
  copy.push({ role: 'user', content: '', images: base64List });
  return copy;
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

export async function POST(req) {
  try {
    // Enforce request body size cap.
    const lengthHeader = Number(req.headers.get?.('content-length') || 0);
    if (lengthHeader && lengthHeader > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large.' }, 413);
    }

    const body = await req.json();
    const imageList = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    const baseMessages = normalizeMessages(body.messages, body.systemPrompt);
    const messages = attachImagesToLastUserMessage(baseMessages, imageList);

    if (messages.length === 0) {
      return jsonResponse({ error: 'At least one chat message is required.' }, 400);
    }

    const requestedMax = Number(body.max_tokens) || SALAD_MAX_TOKENS;
    const safeMax = Math.max(1, Math.min(requestedMax, MAX_TOKENS_CAP));

    // Force the vision model whenever images are present, regardless of the
    // model requested by the client.
    const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
    const requestedModel = typeof body.model === 'string' ? body.model : SALAD_MODEL;
    const effectiveModel = hasImages ? SALAD_VISION_MODEL : requestedModel;

    if (!SALAD_API_URL || !SALAD_API_KEY) {
      const fallback = await tryProviderFallbacks(messages, safeMax);
      if (fallback?.text) {
        return jsonResponse({ result: fallback.text, provider: fallback.provider }, 200);
      }
      return jsonResponse({ error: 'Salad API URL or key is not configured, and no fallback provider succeeded.' }, 500);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SALAD_TIMEOUT_MS);
    const chatUrls = candidateChatUrls(SALAD_API_URL);
    let upstream;
    try {
      upstream = await fetchChatUpstream(chatUrls, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Salad-Api-Key': SALAD_API_KEY,
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages,
          stream: body.stream !== false,
          max_tokens: safeMax,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      // Don't leak upstream provider error verbatim; log it and return a generic message.
      console.error('Upstream chat error:', upstream.status, errorText?.slice(0, 500));
      const fallback = await tryProviderFallbacks(messages, safeMax);
      if (fallback?.text) {
        return jsonResponse({ result: fallback.text, provider: fallback.provider }, 200);
      }
      if (upstream.status === 404) {
        return jsonResponse({ error: getEndpoint404Guidance(chatUrls) }, 502);
      }
      return jsonResponse({ error: `Chat upstream error (${upstream.status}).` }, upstream.status);
    }

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
    try {
      const body = await req.clone().json().catch(() => ({}));
      const imageList = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
      const baseMessages = normalizeMessages(body.messages, body.systemPrompt);
      const messages = attachImagesToLastUserMessage(baseMessages, imageList);
      const requestedMax = Number(body.max_tokens) || SALAD_MAX_TOKENS;
      const safeMax = Math.max(1, Math.min(requestedMax, MAX_TOKENS_CAP));
      const fallback = await tryProviderFallbacks(messages, safeMax);
      if (fallback?.text) {
        return jsonResponse({ result: fallback.text, provider: fallback.provider }, 200);
      }
    } catch {
      // Ignore fallback parse failure.
    }
    const message = err.name === 'AbortError' ? 'Chat request timed out.' : 'Chat request failed.';
    return jsonResponse({ error: message }, 500);
  }
}
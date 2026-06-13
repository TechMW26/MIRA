export const config = { maxDuration: 60 };

const SALAD_API_URL = process.env.SALAD_API_URL || process.env.API_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY || process.env.API_KEY;
const SALAD_MODEL = process.env.SALAD_MODEL || 'llama3.2';
const SALAD_VISION_MODEL = process.env.SALAD_VISION_MODEL || 'llama3.2-vision';
const SALAD_MAX_TOKENS = Number(process.env.SALAD_MAX_TOKENS || 2048);
const SALAD_TIMEOUT_MS = Number(process.env.SALAD_TIMEOUT_MS || 55000);

// Hard caps to prevent DoS / runaway requests.
const MAX_BODY_BYTES = 5 * 1024 * 1024;        // 5 MB request body
const MAX_MESSAGES = 40;                        // history depth
const MAX_TEXT_CONTENT_CHARS = 24_000;          // total chars across a single message
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 8192;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

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
  if (!SALAD_API_URL || !SALAD_API_KEY) {
    return jsonResponse({ error: 'Salad API URL or key is not configured.' }, 500);
  }

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SALAD_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(SALAD_API_URL, {
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
    const message = err.name === 'AbortError' ? 'Chat request timed out.' : 'Chat request failed.';
    console.error('Chat API error:', err?.message);
    return jsonResponse({ error: message }, 500);
  }
}
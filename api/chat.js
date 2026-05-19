export const config = { maxDuration: 60 };

const SALAD_API_URL = process.env.SALAD_API_URL || process.env.API_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY || process.env.API_KEY;
const SALAD_MODEL = process.env.SALAD_MODEL || 'llama3.2-vision';
const SALAD_MAX_TOKENS = Number(process.env.SALAD_MAX_TOKENS || 2048);
const SALAD_TIMEOUT_MS = Number(process.env.SALAD_TIMEOUT_MS || 55000);

// Hard caps to prevent DoS / runaway requests.
const MAX_BODY_BYTES = 5 * 1024 * 1024;        // 5 MB request body
const MAX_MESSAGES = 200;                       // history depth
const MAX_TEXT_CONTENT_CHARS = 200_000;         // total chars across a single message
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 8192;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

function imageToDataUrl(image) {
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw) return null;
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `data:${image?.mimeType || image?.type || 'image/jpeg'};base64,${raw}`;
}

function contentToParts(content) {
  if (Array.isArray(content)) return [...content];
  if (content == null) return [];
  return [{ type: 'text', text: String(content) }];
}

function withImages(messages, images = []) {
  const imageParts = images
    .map(imageToDataUrl)
    .filter(Boolean)
    .map((url) => ({ type: 'image_url', image_url: { url } }));

  if (imageParts.length === 0) return messages;

  const nextMessages = [...messages];
  let userIndex = -1;
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    if (nextMessages[index]?.role === 'user') {
      userIndex = index;
      break;
    }
  }

  if (userIndex === -1) {
    nextMessages.push({ role: 'user', content: imageParts });
    return nextMessages;
  }

  const target = nextMessages[userIndex];
  nextMessages[userIndex] = {
    ...target,
    content: [...contentToParts(target.content), ...imageParts],
  };
  return nextMessages;
}

function normalizeMessages(messages = [], systemPrompt) {
  const list = Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [];
  const normalized = list
    .filter((message) => message?.role && message.content != null)
    .map((message) => {
      const role = ALLOWED_ROLES.has(message.role) ? message.role : 'user';
      let content = message.content;
      // Cap text length to defend against pathological payloads.
      if (typeof content === 'string') {
        content = content.slice(0, MAX_TEXT_CONTENT_CHARS);
      } else if (Array.isArray(content)) {
        let remaining = MAX_TEXT_CONTENT_CHARS;
        content = content.slice(0, 32).map((part) => {
          if (part?.type === 'text' && typeof part.text === 'string') {
            const text = part.text.slice(0, Math.max(0, remaining));
            remaining -= text.length;
            return { type: 'text', text };
          }
          return part;
        });
      }
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
    const messages = withImages(normalizeMessages(body.messages, body.systemPrompt), imageList);

    if (messages.length === 0) {
      return jsonResponse({ error: 'At least one chat message is required.' }, 400);
    }

    const requestedMax = Number(body.max_tokens) || SALAD_MAX_TOKENS;
    const safeMax = Math.max(1, Math.min(requestedMax, MAX_TOKENS_CAP));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SALAD_TIMEOUT_MS);
    const upstream = await fetch(SALAD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Salad-Api-Key': SALAD_API_KEY,
      },
      body: JSON.stringify({
        model: typeof body.model === 'string' ? body.model : SALAD_MODEL,
        messages,
        stream: body.stream !== false,
        max_tokens: safeMax,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

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
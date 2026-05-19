export const config = { maxDuration: 60 };

const SALAD_API_URL = process.env.SALAD_API_URL || process.env.API_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY || process.env.API_KEY;
const SALAD_MODEL = process.env.SALAD_MODEL || 'llama3.2-vision';
const SALAD_MAX_TOKENS = Number(process.env.SALAD_MAX_TOKENS || 2048);
const SALAD_TIMEOUT_MS = Number(process.env.SALAD_TIMEOUT_MS || 55000);

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
  const normalized = messages
    .filter((message) => message?.role && message.content != null)
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: message.content,
    }));

  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...normalized.filter((message) => message.role !== 'system')];
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
    const body = await req.json();
    const messages = withImages(normalizeMessages(body.messages, body.systemPrompt), body.images);

    if (messages.length === 0) {
      return jsonResponse({ error: 'At least one chat message is required.' }, 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SALAD_TIMEOUT_MS);
    const upstream = await fetch(SALAD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Salad-Api-Key': SALAD_API_KEY,
      },
      body: JSON.stringify({
        model: body.model || SALAD_MODEL,
        messages,
        stream: body.stream !== false,
        max_tokens: body.max_tokens || SALAD_MAX_TOKENS,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      return jsonResponse({ error: errorText || `Salad API error: ${upstream.status}` }, upstream.status);
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
    const message = err.name === 'AbortError' ? `Salad API timeout after ${SALAD_TIMEOUT_MS}ms` : err.message;
    console.error('Chat API error:', message);
    return jsonResponse({ error: message }, 500);
  }
}
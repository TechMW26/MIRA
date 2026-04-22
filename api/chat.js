export const config = { supportsResponseStreaming: true, maxDuration: 60 };

const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || 'http://1.193.139.71:34906';
const INFERENCE_PUBLIC_PATH = process.env.INFERENCE_PUBLIC_PATH || '/public/analyze';
const INFERENCE_PROTECTED_PATH = process.env.INFERENCE_PROTECTED_PATH || '/v1/analyze';
const INFERENCE_APP_TOKEN = process.env.INFERENCE_APP_TOKEN;
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY;
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS || 35000);

function getLastUserPrompt(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) {
      return String(messages[i].content).trim();
    }
  }
  return '';
}

// 1x1 transparent PNG used as a placeholder when the user has no image attached,
// since the upstream multimodal endpoint expects a `file` field to be present.
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function buildFileFromImage(image) {
  const mimeType = image?.mimeType || 'image/jpeg';
  const base64 = image?.base64 || '';
  if (!base64) return null;

  const sanitized = base64.includes(',') ? base64.split(',')[1] : base64;
  const bytes = Buffer.from(sanitized, 'base64');
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const blob = new Blob([bytes], { type: mimeType });

  return { blob, filename: `upload.${ext}` };
}

function buildPlaceholderFile() {
  const bytes = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64');
  return {
    blob: new Blob([bytes], { type: 'image/png' }),
    filename: 'placeholder.png',
  };
}

async function callInference(prompt, image) {
  if (!prompt) {
    return { ok: false, status: 400, error: 'Prompt is required.' };
  }

  const file = buildFileFromImage(image) || buildPlaceholderFile();

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('file', file.blob, file.filename);

  const attempts = [];
  if (INFERENCE_API_KEY) {
    attempts.push({
      url: `${INFERENCE_BASE_URL}${INFERENCE_PROTECTED_PATH}`,
      headers: { 'X-API-KEY': INFERENCE_API_KEY },
    });
  }
  attempts.push({
    url: `${INFERENCE_BASE_URL}${INFERENCE_PUBLIC_PATH}`,
    headers: { 'X-App-Token': INFERENCE_APP_TOKEN || '' },
  });

  let lastError = 'Inference provider unavailable.';

  for (const attempt of attempts) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: attempt.headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload?.result) {
        return {
          ok: true,
          status: 200,
          payload,
        };
      }

      const error = payload?.error || payload?.message || `Inference error: ${res.status}`;
      lastError = error;
      console.warn(`Inference call failed ${res.status}: ${error}`);
    } catch (err) {
      lastError = err.name === 'AbortError' ? `Inference timeout after ${INFERENCE_TIMEOUT_MS}ms` : err.message;
      console.warn('Inference request failed:', err.message);
    }
  }

  return { ok: false, status: 503, error: lastError };
}

function createSseResponse(text) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(req) {
  try {
    const { messages = [], images = [] } = await req.json();

    const prompt = getLastUserPrompt(messages);
    const image = Array.isArray(images) && images.length > 0 ? images[0] : null;

    const inference = await callInference(prompt, image);
    if (!inference.ok) {
      return new Response(JSON.stringify({ error: inference.error }), {
        status: inference.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return createSseResponse(inference.payload.result);
  } catch (err) {
    console.error('Chat API error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

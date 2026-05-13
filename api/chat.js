export const config = { maxDuration: 60 };

const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || 'http://142.112.39.215:50971';
const INFERENCE_PUBLIC_PATH = process.env.INFERENCE_PUBLIC_PATH || '/public/analyze';
const INFERENCE_PROTECTED_PATH = process.env.INFERENCE_PROTECTED_PATH || '/v1/analyze';
const INFERENCE_APP_TOKEN = process.env.INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || 'PRO_SAFETY_TOKEN_2026';
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS || 35000);

function getLastUserPrompt(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) {
      return String(messages[i].content).trim();
    }
  }
  return '';
}

// Small valid 64x64 white JPEG used as a placeholder when the user has no image
// attached. The upstream multimodal endpoint requires a real decodable image
// in the `file` field; a 1x1 transparent PNG is rejected with HTTP 503.
const PLACEHOLDER_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

function buildPlaceholderFile() {
  const bytes = Buffer.from(PLACEHOLDER_JPEG_BASE64, 'base64');
  return {
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    filename: 'placeholder.jpg',
  };
}

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

function buildFormData(prompt, image) {
  const file = buildFileFromImage(image) || buildPlaceholderFile();
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('file', file.blob, file.filename);
  return formData;
}

async function callInference(prompt, image) {
  if (!prompt) {
    return { ok: false, status: 400, error: 'Prompt is required.' };
  }

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
        body: buildFormData(prompt, image),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload?.result) {
        return { ok: true, status: 200, payload };
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

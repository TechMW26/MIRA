export const config = { maxDuration: 60 };

const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || 'http://194.68.245.162:22159';
const INFERENCE_PUBLIC_PATH = process.env.INFERENCE_PUBLIC_PATH || '/public/analyze';
const INFERENCE_PROTECTED_PATH = process.env.INFERENCE_PROTECTED_PATH || '/v1/analyze';
const INFERENCE_APP_TOKEN = process.env.INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || 'PRO_SAFETY_TOKEN_2026';
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS || 35000);

const PLACEHOLDER_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

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
  const bytes = Buffer.from(PLACEHOLDER_JPEG_BASE64, 'base64');
  return {
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    filename: 'placeholder.jpg',
  };
}

async function callInference(prompt, image) {
  if (!prompt) {
    return { ok: false, status: 400, error: 'prompt is required' };
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
        return { ok: true, status: 200, payload };
      }

      const error = payload?.error || payload?.message || `Inference error: ${res.status}`;
      lastError = error;
      console.warn(`Inference image call failed ${res.status}: ${error}`);
    } catch (err) {
      lastError = err.name === 'AbortError' ? `Inference timeout after ${INFERENCE_TIMEOUT_MS}ms` : err.message;
      console.warn('Inference image request failed:', err.message);
    }
  }

  return { ok: false, status: 503, error: lastError };
}

export async function POST(req) {
  try {
    const { prompt, images = [] } = await req.json();
    const image = Array.isArray(images) && images.length > 0 ? images[0] : null;

    const inference = await callInference(prompt, image);
    if (!inference.ok) {
      return new Response(JSON.stringify({ error: inference.error }), {
        status: inference.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      inference_type: inference.payload.inference_type,
      model: inference.payload.model,
      result: inference.payload.result,
      execution_time_ms: inference.payload.execution_time_ms,
      provider: 'custom-vision-endpoint',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Image API error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { maxDuration: 60 };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const ALLOWED_MODELS = new Set(['flux', 'turbo']);
const DEFAULT_SIZE = 1024;
const MAX_PROMPT_CHARS = 900;

function compactPrompt(value = '') {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_PROMPT_CHARS) return compact;
  return compact.slice(0, MAX_PROMPT_CHARS).replace(/\s+\S*$/, '').trim();
}

function boundedSize(value) {
  const size = Number(value || DEFAULT_SIZE);
  if (!Number.isFinite(size)) return DEFAULT_SIZE;
  return Math.max(512, Math.min(1280, Math.round(size)));
}

function buildPollinationsUrl({ prompt, model, seed, width, height }) {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    enhance: 'true',
    model,
    seed: String(seed || 1),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

export async function GET(req) {
  const url = new URL(req.url);
  const prompt = compactPrompt(url.searchParams.get('prompt') || '');
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const modelParam = String(url.searchParams.get('model') || 'flux').toLowerCase();
  const model = ALLOWED_MODELS.has(modelParam) ? modelParam : 'flux';
  const width = boundedSize(url.searchParams.get('width'));
  const height = boundedSize(url.searchParams.get('height'));
  const seed = Number(url.searchParams.get('seed') || 1) || 1;
  const target = buildPollinationsUrl({ prompt, model, seed, width, height });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MIRA-GeneratedImage/1.0)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
      },
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!ALLOWED_MIME.test(contentType.split(';')[0].trim())) {
      return new Response(JSON.stringify({ error: `Unsupported content-type: ${contentType}` }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: 'Image too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = err?.name === 'AbortError' ? 'Image generation timed out' : 'Image generation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
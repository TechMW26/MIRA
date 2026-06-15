export const config = { maxDuration: 60 };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const ALLOWED_MODELS = new Set(['flux', 'flux-pro', 'flux-realism', 'turbo']);
const DEFAULT_SIZE = 1024;
const MAX_PROMPT_CHARS = 900;
const UPSTREAM_TIMEOUT_MS = 18000;
const UPSTREAM_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const ALT_IMAGE_SEARCH_TIMEOUT_MS = 12000;
const SEARCH_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'to', 'from', 'by', 'into', 'split-shot', 'photograph', 'photo', 'image', 'stunning', 'majestic', 'crystal-clear']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGeneratedImageWithRetries(target) {
  let lastResponse = null;
  let lastError = null;
  const pollinationsKey = String(process.env.POLLINATIONS_API_KEY || '').trim();

  for (let attempt = 0; attempt < UPSTREAM_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-GeneratedImage/1.0)',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(pollinationsKey ? { Authorization: `Bearer ${pollinationsKey}` } : {}),
        },
      });
      clearTimeout(timeout);

      if (upstream.ok) return { upstream };
      lastResponse = upstream;

      if (!RETRYABLE_STATUS.has(upstream.status) || attempt === UPSTREAM_RETRY_ATTEMPTS - 1) {
        return { upstream };
      }

      await sleep(900 + (attempt * 900));
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt === UPSTREAM_RETRY_ATTEMPTS - 1) break;
      await sleep(900 + (attempt * 900));
    }
  }

  if (lastResponse) return { upstream: lastResponse };
  if (lastError) throw lastError;
  throw new Error('Image generation failed');
}

async function fetchSearchFallbackImage(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALT_IMAGE_SEARCH_TIMEOUT_MS);
  try {
    const words = String(prompt || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !SEARCH_STOPWORDS.has(word));
    const compact = words.slice(0, 7).join(' ').trim();
    const queries = [String(prompt || '').trim(), compact, 'elephant swimming', 'wildlife underwater']
      .filter(Boolean)
      .filter((query, index, arr) => arr.indexOf(query) === index);

    let candidates = [];
    for (const query of queries) {
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageFallback/1.0)',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'application/json',
        },
      });
      if (!searchRes.ok) continue;
      const payload = await searchRes.json().catch(() => ({}));
      const pages = Object.values(payload?.query?.pages || {});
      candidates = pages
        .map((page) => page?.imageinfo?.[0])
        .filter((info) => info?.url && ALLOWED_MIME.test(String(info?.mime || '').trim()))
        .map((info) => info.url)
        .slice(0, 5);
      if (candidates.length) break;
    }

    for (const imageUrl of candidates) {
      const imageRes = await fetch(imageUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageFallback/1.0)',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
        },
      });
      if (!imageRes.ok) continue;
      const contentType = imageRes.headers.get('content-type') || '';
      if (!ALLOWED_MIME.test(contentType.split(';')[0].trim())) continue;
      const buffer = await imageRes.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) continue;
      return { buffer, contentType };
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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
  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (key) params.set('key', key);
  return `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params.toString()}`;
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

  const modelParam = String(url.searchParams.get('model') || 'flux-realism').toLowerCase();
  const model = ALLOWED_MODELS.has(modelParam) ? modelParam : 'flux-realism';
  const width = boundedSize(url.searchParams.get('width'));
  const height = boundedSize(url.searchParams.get('height'));
  const seed = Number(url.searchParams.get('seed') || 1) || 1;
  const target = buildPollinationsUrl({ prompt, model, seed, width, height });

  try {
    const { upstream } = await fetchGeneratedImageWithRetries(target);

    if (!upstream.ok) {
      if (upstream.status === 402 || upstream.status === 403 || upstream.status === 429) {
        const fallback = await fetchSearchFallbackImage(prompt).catch(() => null);
        if (fallback?.buffer) {
          return new Response(fallback.buffer, {
            status: 200,
            headers: {
              'Content-Type': fallback.contentType,
              'Cache-Control': 'public, max-age=21600',
              'Access-Control-Allow-Origin': '*',
              'X-MIRA-Image-Source': 'search-fallback',
            },
          });
        }
      }
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!ALLOWED_MIME.test(contentType.split(';')[0].trim())) {
      return new Response(JSON.stringify({ error: `Unsupported content-type: ${contentType}` }), {
        status: 415,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: 'Image too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
    const message = err?.name === 'AbortError' ? 'Image generation timed out' : 'Image generation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
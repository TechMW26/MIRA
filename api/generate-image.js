export const config = { maxDuration: 60 };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const ALLOWED_MODELS = new Set(['flux', 'flux-schnell', 'flux-realism', 'flux-pro', 'seedream-pro']);
const DEFAULT_SIZE = 1024;
const MAX_PROMPT_CHARS = 900;
const UPSTREAM_TIMEOUT_MS = 18000;
const UPSTREAM_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const MODEL_FALLBACK_CHAIN = ['flux', 'flux-schnell', 'flux-realism', 'flux-pro', 'seedream-pro'];
const SAFE_MODEL_CHAIN = ['flux', 'flux-schnell', 'flux-realism', 'flux-pro', 'seedream-pro'];
const NSFW_PROMPT_PATTERN = /\b(nude|nudity|naked|explicit|erotic|porn|pornographic|xxx|18\+|lewd|nsfw|genitals?|penis|vagina|sex|sexual|breasts?|nipples?)\b/i;
const SAFE_NEGATIVE_PROMPT = 'nsfw, nude, naked, explicit, erotic, porn, sexual content, genitalia, breasts, nipples';
const SAFE_SUFFIX = 'family-friendly, non-sexual, no nudity, fully clothed, safe for work';
const POLLINATIONS_HOSTS = ['https://gen.pollinations.ai', 'https://image.pollinations.ai'];

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

function buildPollinationsUrl({ prompt, model, seed, width, height, host = 'https://gen.pollinations.ai' }) {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    enhance: 'true',
    model,
    seed: String(seed || 1),
  });
  if (!NSFW_PROMPT_PATTERN.test(String(prompt || ''))) {
    params.set('negative', SAFE_NEGATIVE_PROMPT);
    params.set('safe', 'true');
  }
  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (key) params.set('key', key);
  return `${host}/image/${encodeURIComponent(prompt)}?${params.toString()}`;
}

function getModelAttemptOrder(requestedModel = 'flux', unsafe = false) {
  if (!unsafe) return SAFE_MODEL_CHAIN;
  const normalized = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'flux';
  const rest = MODEL_FALLBACK_CHAIN.filter((model) => model !== normalized);
  return [normalized, ...rest];
}

function buildSafePrompt(prompt = '', unsafe = false) {
  const value = compactPrompt(prompt);
  if (!value || unsafe) return value;
  const lower = value.toLowerCase();
  if (lower.includes('safe for work') || lower.includes('no nudity') || lower.includes('family-friendly')) {
    return value;
  }
  return `${value}, ${SAFE_SUFFIX}`;
}

export async function GET(req) {
  const url = new URL(req.url);
  const rawPrompt = compactPrompt(url.searchParams.get('prompt') || '');
  const unsafe = String(url.searchParams.get('unsafe') || '0') === '1';
  const prompt = buildSafePrompt(rawPrompt, unsafe);
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!unsafe && NSFW_PROMPT_PATTERN.test(rawPrompt)) {
    return new Response(JSON.stringify({ error: 'NSFW prompt blocked in safe mode. Switch to Mira Locked for unrestricted generation.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const modelParam = String(url.searchParams.get('model') || 'flux').toLowerCase();
  const model = ALLOWED_MODELS.has(modelParam) ? modelParam : 'flux';
  const modelAttempts = getModelAttemptOrder(model, unsafe);
  const width = boundedSize(url.searchParams.get('width'));
  const height = boundedSize(url.searchParams.get('height'));
  const seed = Number(url.searchParams.get('seed') || 1) || 1;

  try {
    let lastStatus = null;
    let lastContentType = '';

    for (const attemptModel of modelAttempts) {
      let upstream = null;

      for (const host of POLLINATIONS_HOSTS) {
        const target = buildPollinationsUrl({ prompt, model: attemptModel, seed, width, height, host });
        const result = await fetchGeneratedImageWithRetries(target);
        upstream = result.upstream;
        if (upstream?.ok) break;
      }

      if (!upstream) continue;

      if (!upstream.ok) {
        lastStatus = upstream.status;
        continue;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (!ALLOWED_MIME.test(contentType.split(';')[0].trim())) {
        lastContentType = contentType;
        continue;
      }

      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
        continue;
      }

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-MIRA-Image-Model': attemptModel,
          'X-MIRA-Safety': unsafe ? 'unsafe' : 'safe',
        },
      });
    }

    const error = lastContentType
      ? `Unsupported content-type: ${lastContentType}`
      : `Upstream ${lastStatus || 502}`;

    return new Response(JSON.stringify({ error, modelAttempts }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Image generation timed out' : 'Image generation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
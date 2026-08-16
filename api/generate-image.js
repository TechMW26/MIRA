export const config = { maxDuration: 60 };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const DEFAULT_SIZE = 1024;
const MAX_PROMPT_CHARS = 900;
const UPSTREAM_TIMEOUT_MS = 18000;
const UPSTREAM_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const NSFW_PROMPT_PATTERN = /\b(nude|nudity|naked|explicit|erotic|porn|pornographic|xxx|18\+|lewd|nsfw|genitals?|penis|vagina|sex|sexual|breasts?|nipples?)\b/i;
const INVALID_PROMPT_PATTERN = /(?:^|\[)(?:using tools?|mira_tool)|^(?:\.{2,}|…+|image|picture|photo|generated image)$/i;
const SAFE_NEGATIVE_PROMPT = 'nsfw, nude, naked, explicit, erotic, porn, sexual content, genitalia, breasts, nipples';
const POLLINATIONS_ORIGIN = 'https://gen.pollinations.ai';
const MODEL_CACHE = { expiresAt: 0, models: [] };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGeneratedImageWithRetries(target, pollinationsKey) {
  let lastResponse = null;
  let lastError = null;

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

export function buildPollinationsUrl({ prompt, model, seed, width, height }) {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    enhance: 'false',
    model,
    seed: String(seed || 1),
  });
  if (!NSFW_PROMPT_PATTERN.test(String(prompt || ''))) {
    params.set('negative', SAFE_NEGATIVE_PROMPT);
    params.set('safe', 'true');
  }
  return `${POLLINATIONS_ORIGIN}/image/${encodeURIComponent(prompt)}?${params.toString()}`;
}

export function parsePollinationsImageModels(payload = []) {
  const items = Array.isArray(payload) ? payload : (payload?.data || payload?.models || []);
  return Array.from(new Set(items.flatMap((item) => {
    const id = String(item?.id || item?.name || item?.model || '').trim();
    const modalities = item?.outputModalities || item?.output_modalities || [];
    const imageCapable = !Array.isArray(modalities)
      || modalities.length === 0
      || modalities.some((value) => String(value).toLowerCase() === 'image');
    return id && imageCapable ? [id] : [];
  })));
}

export function clearPollinationsModelCache() {
  MODEL_CACHE.expiresAt = 0;
  MODEL_CACHE.models = [];
}

async function getModelAttemptOrder(key) {
  const configured = String(process.env.POLLINATIONS_IMAGE_MODEL || '').trim();
  if (MODEL_CACHE.models.length && MODEL_CACHE.expiresAt > Date.now()) {
    return Array.from(new Set([configured, ...MODEL_CACHE.models].filter(Boolean))).slice(0, 3);
  }

  try {
    const response = await fetch(`${POLLINATIONS_ORIGIN}/image/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Model registry failed (${response.status}).`);
    const models = parsePollinationsImageModels(await response.json());
    if (!models.length) throw new Error('No Pollinations image model is available.');
    MODEL_CACHE.models = models;
    MODEL_CACHE.expiresAt = Date.now() + 5 * 60 * 1000;
    return Array.from(new Set([configured, ...models].filter(Boolean))).slice(0, 3);
  } catch (error) {
    if (configured) return [configured];
    throw error;
  }
}

function buildSafePrompt(prompt = '') {
  return compactPrompt(prompt);
}

export async function GET(req) {
  const url = new URL(req.url);
  const rawPrompt = compactPrompt(url.searchParams.get('prompt') || '');
  const prompt = buildSafePrompt(rawPrompt);
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (rawPrompt.length < 3 || INVALID_PROMPT_PATTERN.test(rawPrompt)) {
    return new Response(JSON.stringify({ error: 'The image prompt is incomplete.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (NSFW_PROMPT_PATTERN.test(rawPrompt)) {
    return new Response(JSON.stringify({ error: 'This prompt is blocked by the image safety policy.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const pollinationsKey = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (!pollinationsKey) {
    return new Response(JSON.stringify({ error: 'POLLINATIONS_API_KEY is not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const width = boundedSize(url.searchParams.get('width'));
  const height = boundedSize(url.searchParams.get('height'));
  const seed = Number(url.searchParams.get('seed') || 1) || 1;

  try {
    const modelAttempts = await getModelAttemptOrder(pollinationsKey);
    let lastStatus = null;
    let lastContentType = '';

    for (const attemptModel of modelAttempts) {
      const target = buildPollinationsUrl({ prompt, model: attemptModel, seed, width, height });
      const { upstream } = await fetchGeneratedImageWithRetries(target, pollinationsKey);

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
          'X-MIRA-Safety': 'safe',
          'X-MIRA-Image-Provider': 'pollinations',
        },
      });
    }

    const error = lastContentType
      ? `Unsupported content-type: ${lastContentType}`
      : `Upstream ${lastStatus || 502}`;

    return new Response(JSON.stringify({ error }), {
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

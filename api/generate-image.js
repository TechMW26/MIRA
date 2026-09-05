export const config = { maxDuration: 60 };
import { guardRequest } from './_requestSecurity.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const DEFAULT_SIZE = 1024;
const MAX_PROMPT_CHARS = 4000;
const MAX_REFERENCE_URL_CHARS = 4096;
const UPSTREAM_TIMEOUT_MS = 26000;
const UPSTREAM_RETRY_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const NSFW_PROMPT_PATTERN = /\b(nude|nudity|naked|explicit|erotic|porn|pornographic|xxx|18\+|lewd|nsfw|genitals?|penis|vagina|sex|sexual|breasts?|nipples?)\b/i;
const INVALID_PROMPT_PATTERN = /(?:^|\[)(?:using tools?|mira_tool)|^(?:\.{2,}|…+|image|picture|photo|generated image)$/i;
const POLLINATIONS_ORIGIN = String(process.env.POLLINATIONS_API_URL || 'https://gen.pollinations.ai')
  .trim()
  .replace(/\/+$/, '');
const POLLINATIONS_GENERATIONS_URL = `${POLLINATIONS_ORIGIN}/v1/images/generations`;
const FRESH_IMAGE_MODEL = 'klein';
const EDIT_IMAGE_MODEL = 'kontext';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeReferenceImage(value = '') {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (candidate.length > MAX_REFERENCE_URL_CHARS) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function buildPollinationsPayload({ prompt, width, height, referenceImage = '' }) {
  const normalizedReference = normalizeReferenceImage(referenceImage);
  if (normalizedReference === null) throw new TypeError('Invalid reference image URL');

  return {
    prompt,
    model: normalizedReference ? EDIT_IMAGE_MODEL : FRESH_IMAGE_MODEL,
    n: 1,
    size: `${width}x${height}`,
    quality: 'high',
    response_format: 'b64_json',
    safe: 'true,nsfw',
    ...(normalizedReference ? { image: normalizedReference } : {}),
  };
}

async function fetchGenerationWithRetries(payload, pollinationsKey) {
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt < UPSTREAM_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(POLLINATIONS_GENERATIONS_URL, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          Authorization: `Bearer ${pollinationsKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'MIRA-GeneratedImage/1.0',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        body: JSON.stringify(payload),
      });
      clearTimeout(timeout);

      if (upstream.ok) return upstream;
      lastResponse = upstream;
      if (!RETRYABLE_STATUS.has(upstream.status) || attempt === UPSTREAM_RETRY_ATTEMPTS - 1) {
        return upstream;
      }
      await sleep(900 + (attempt * 900));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === UPSTREAM_RETRY_ATTEMPTS - 1) break;
      await sleep(900 + (attempt * 900));
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error('Image generation failed');
}

function detectImageMime(bytes, declaredMime = '') {
  const normalized = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_MIME.test(normalized)) return normalized;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return 'image/gif';
  return '';
}

async function decodeImageResponse(upstream) {
  const payload = await upstream.json().catch(() => null);
  const item = payload?.data?.[0];
  const encoded = String(item?.b64_json || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!encoded || !/^[a-z0-9+/=\s]+$/i.test(encoded)) {
    throw new Error('Pollinations returned no image data');
  }
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Generated image has an invalid size');
  }
  const contentType = detectImageMime(bytes, item?.media_type);
  if (!contentType) throw new Error('Pollinations returned an unsupported image format');
  return { bytes, contentType };
}

async function upstreamFailureResponse(upstream) {
  await upstream.body?.cancel?.().catch?.(() => {});
  const authenticationFailed = upstream.status === 401 || upstream.status === 403;
  const paymentRequired = upstream.status === 402;
  const rateLimited = upstream.status === 429;
  const error = authenticationFailed
    ? 'The image provider rejected its server credential.'
    : paymentRequired
      ? 'The image provider account requires additional balance.'
      : rateLimited
        ? 'The image provider is temporarily rate limited.'
        : 'The image provider could not complete the request.';
  return new Response(JSON.stringify({
    error,
    code: authenticationFailed
      ? 'provider_authentication_failed'
      : paymentRequired
        ? 'provider_balance_required'
        : rateLimited
          ? 'provider_rate_limited'
          : 'provider_request_failed',
  }), {
    status: authenticationFailed || paymentRequired || rateLimited ? 503 : 502,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-MIRA-Upstream-Status': String(upstream.status),
    },
  });
}

export async function GET(req) {
  const guarded = guardRequest(req, { limit: 12, windowMs: 60_000, key: 'generate-image' });
  if (guarded) return guarded;
  const url = new URL(req.url);
  const rawPrompt = compactPrompt(url.searchParams.get('prompt') || '');
  if (!rawPrompt) {
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

  const referenceImage = normalizeReferenceImage(url.searchParams.get('referenceImage') || '');
  if (referenceImage === null) {
    return new Response(JSON.stringify({ error: 'The reference image URL is invalid.' }), {
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

  try {
    const payload = buildPollinationsPayload({
      prompt: rawPrompt,
      width: boundedSize(url.searchParams.get('width')),
      height: boundedSize(url.searchParams.get('height')),
      referenceImage,
    });
    const upstream = await fetchGenerationWithRetries(payload, pollinationsKey);
    if (!upstream.ok) {
      return upstreamFailureResponse(upstream);
    }

    const { bytes, contentType } = await decodeImageResponse(upstream);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-MIRA-Safety': 'safe',
        'X-MIRA-Image-Provider': 'pollinations',
        'X-MIRA-Image-Mode': referenceImage ? 'edit' : 'generate',
      },
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return new Response(JSON.stringify({ error: timedOut ? 'Image generation timed out' : 'Image generation failed' }), {
      status: timedOut ? 504 : 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

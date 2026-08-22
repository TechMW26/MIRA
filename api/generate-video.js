export const config = { maxDuration: 120 };
import { guardRequest } from './_requestSecurity.js';

const POLLINATIONS_ORIGIN = String(process.env.POLLINATIONS_API_URL || 'https://gen.pollinations.ai')
  .trim()
  .replace(/\/+$/, '');

const ALLOWED_MODELS = new Set(['wan-pro', 'wan-pro-1080p']);
const ALLOWED_MIME = /^video\/(mp4|webm|ogg|quicktime)$/i;
const MAX_PROMPT_CHARS = 900;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60000;
const UPSTREAM_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactPrompt(value = '') {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_PROMPT_CHARS) return compact;
  return compact.slice(0, MAX_PROMPT_CHARS).replace(/\s+\S*$/, '').trim();
}

function boundedDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration)) return 5;
  return Math.max(3, Math.min(12, Math.round(duration)));
}

function resolveVideoUrlFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return '';
  return [
    payload.url,
    payload.video,
    payload.video_url,
    payload.output?.url,
    payload.result?.url,
    payload.data?.url,
    payload.choices?.[0]?.url,
    payload.choices?.[0]?.message?.content,
  ].find((value) => /^https?:\/\//i.test(String(value || '').trim())) || '';
}

async function fetchWithRetries(target, key = '') {
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
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-GeneratedVideo/1.0)',
          Accept: 'video/mp4,video/webm,application/json;q=0.9,*/*;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
      });
      clearTimeout(timeout);

      if (upstream.ok) return upstream;
      lastResponse = upstream;
      if (!RETRYABLE_STATUS.has(upstream.status) || attempt === UPSTREAM_RETRY_ATTEMPTS - 1) {
        return upstream;
      }
      await sleep(1200 + (attempt * 1000));
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt === UPSTREAM_RETRY_ATTEMPTS - 1) break;
      await sleep(1200 + (attempt * 1000));
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error('Video generation failed');
}

function buildVideoUrl({ prompt, model, duration, resolution, seed }) {
  const params = new URLSearchParams({
    model,
    duration: String(duration),
    resolution,
    seed: String(seed),
    nologo: 'true',
    enhance: 'true',
  });
  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (key) params.set('key', key);
  return `${POLLINATIONS_ORIGIN}/video/${encodeURIComponent(prompt)}?${params.toString()}`;
}

export async function GET(req) {
  const guarded = guardRequest(req, { limit: 4, windowMs: 60_000, key: 'generate-video' });
  if (guarded) return guarded;
  const url = new URL(req.url);
  const prompt = compactPrompt(url.searchParams.get('prompt') || '');
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const modelParam = String(url.searchParams.get('model') || process.env.POLLINATIONS_VIDEO_MODEL || 'wan-pro').toLowerCase();
  const model = ALLOWED_MODELS.has(modelParam) ? modelParam : 'wan-pro';
  const duration = boundedDuration(url.searchParams.get('duration'));
  const resolution = String(url.searchParams.get('resolution') || '1080p').toLowerCase();
  const seed = Number(url.searchParams.get('seed') || 1) || 1;
  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  const target = buildVideoUrl({ prompt, model, duration, resolution, seed });

  try {
    const upstream = await fetchWithRetries(target, key);

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    if (ALLOWED_MIME.test(contentType)) {
      const buffer = await upstream.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > MAX_VIDEO_BYTES) {
        return new Response(JSON.stringify({ error: 'Video too large' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const payload = await upstream.json().catch(() => ({}));
    const videoUrl = resolveVideoUrlFromPayload(payload);
    if (!videoUrl) {
      return new Response(JSON.stringify({ error: 'Video URL not returned by upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const remote = await fetchWithRetries(videoUrl, key);
    if (!remote.ok) {
      return new Response(JSON.stringify({ error: `Video fetch failed ${remote.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const remoteType = (remote.headers.get('content-type') || '').split(';')[0].trim();
    if (!ALLOWED_MIME.test(remoteType)) {
      return new Response(JSON.stringify({ error: `Unsupported content-type: ${remoteType}` }), {
        status: 415,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const remoteBuffer = await remote.arrayBuffer();
    if (!remoteBuffer.byteLength || remoteBuffer.byteLength > MAX_VIDEO_BYTES) {
      return new Response(JSON.stringify({ error: 'Video too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    return new Response(remoteBuffer, {
      status: 200,
      headers: {
        'Content-Type': remoteType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Video generation timed out' : 'Video generation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

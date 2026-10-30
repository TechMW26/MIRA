import { guardRequest } from './_requestSecurity.js';
import { fetchPublicUrl, isPrivateHostname, validatePublicHttpUrl } from './_publicUrl.js';

export { isPrivateHostname } from './_publicUrl.js';

export const config = { maxDuration: 20 };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/i;

function safeUrl(rawUrl) {
  return validatePublicHttpUrl(rawUrl);
}

async function fetchPublicImage(initialTarget, signal) {
  return fetchPublicUrl(initialTarget, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageProxy/1.0)',
      'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
    },
  });
}

export async function GET(req) {
  const guarded = guardRequest(req, { limit: 60, windowMs: 60_000, key: 'image-proxy' });
  if (guarded) return guarded;
  const url = new URL(req.url);
  const target = safeUrl(url.searchParams.get('url') || '');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Invalid or disallowed URL' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetchPublicImage(target, controller.signal);
    clearTimeout(timeout);

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!ALLOWED_MIME.test(contentType.split(';')[0].trim())) {
      return new Response(JSON.stringify({ error: `Unsupported content-type: ${contentType}` }), {
        status: 415, headers: { 'Content-Type': 'application/json' },
      });
    }

    const lenHeader = Number(upstream.headers.get('content-length') || 0);
    if (lenHeader && lenHeader > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: 'Image too large' }), {
        status: 413, headers: { 'Content-Type': 'application/json' },
      });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: 'Image too large' }), {
        status: 413, headers: { 'Content-Type': 'application/json' },
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
    const msg = err?.name === 'AbortError' ? 'Image fetch timed out' : 'Image fetch failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 504, headers: { 'Content-Type': 'application/json' },
    });
  }
}

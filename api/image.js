export const config = { maxDuration: 20 };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/i;

function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1);
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

function safeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl).trim()); } catch { return null; }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (isPrivateHostname(parsed.hostname)) return null;
  return parsed;
}

export async function GET(req) {
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
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Many CDNs require a real UA / Accept header
        'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageProxy/1.0)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
      },
    });
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

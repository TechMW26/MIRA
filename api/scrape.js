export const config = { maxDuration: 25 };

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB cap on scraped content
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Block private/loopback/link-local/metadata addresses to prevent SSRF.
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();

  // Localhost names and common internal hostnames
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;

  // IPv6 loopback / link-local / unique-local
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1);
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
  }

  // IPv4 literal — block all reserved ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map(Number);
    if (a === 10) return true;                            // 10.0.0.0/8
    if (a === 127) return true;                           // loopback
    if (a === 0) return true;                             // 0.0.0.0/8
    if (a === 169 && b === 254) return true;              // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
    if (a >= 224) return true;                            // multicast / reserved
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

async function readCapped(res, limit = MAX_HTML_BYTES) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, limit);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  while (true) { // eslint-disable-line no-constant-condition
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= limit) { try { await reader.cancel(); } catch {} break; }
  }
  out += decoder.decode();
  return out;
}

// Jina AI Reader — free, no key, returns clean markdown from any URL
async function fetchViaJina(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      'Accept': 'application/json',
      'X-Return-Format': 'markdown',
      'X-No-Cache': 'true',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jina error: ${res.status}`);
  const data = await res.json();
  return {
    title: data.data?.title || url,
    url: data.data?.url || url,
    content: (data.data?.content || '').slice(0, MAX_HTML_BYTES),
    description: data.data?.description || '',
  };
}

// Direct fetch fallback
async function fetchDirect(parsed) {
  const res = await fetch(parsed.href, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Re-validate after redirect to prevent open-redirect → SSRF.
  const finalParsed = safeUrl(res.url || parsed.href);
  if (!finalParsed) throw new Error('Blocked URL after redirect');

  const html = await readCapped(res);
  const finalUrl = finalParsed.href;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&') : url;

  const faviconMatch = html.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i);
  let favicon = '';
  if (faviconMatch?.[1]) {
    try { favicon = new URL(faviconMatch[1], finalUrl).href; } catch {}
  }
  if (!favicon) { try { favicon = new URL('/favicon.ico', finalUrl).href; } catch {} }

  function toAbs(val) {
    if (!val) return val;
    const v = String(val).trim();
    const lower = v.toLowerCase();
    // Block dangerous URL schemes outright.
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html') || lower.startsWith('file:')) return '#';
    if (v.startsWith('data:') || v.startsWith('blob:') || v.startsWith('http')) return v;
    if (v.startsWith('//')) return 'https:' + v;
    try { return new URL(v, finalUrl).href; } catch { return v; }
  }

  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?refresh[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip all inline event handlers (on*)
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    // Strip javascript:/vbscript:/data:text/html in any attribute
    .replace(/(\s(?:href|src|action|formaction|xlink:href|poster|background)\s*=\s*["'])\s*(?:javascript|vbscript|data\s*:\s*text\/html|file)\s*:[^"']*(["'])/gi, '$1#$2')
    .replace(/(\s+src=["'])([^"']+)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`)
    .replace(/(\s+href=["'])([^"'#][^"']*)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`)
    .replace(/<img[^>]*(?:width|height)=["']1["'][^>]*>/gi, '');

  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ').trim();

  return { title, url: finalUrl, favicon, html: cleanHtml, content: plainText.slice(0, 20000), truncated: plainText.length > 20000 };
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url?.trim()) return new Response(JSON.stringify({ error: 'URL required' }), { status: 400 });

    const parsed = safeUrl(url);
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: 'URL is not allowed. Only public http(s) URLs may be scraped.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Try Jina first (best quality, works on all sites) — Jina also enforces public URLs.
    let result;
    try {
      const jina = await fetchViaJina(parsed.href);
      // Also get favicon and html via direct fetch
      let favicon = '';
      let html = '';
      try {
        const direct = await fetchDirect(parsed);
        favicon = direct.favicon;
        html = direct.html;
      } catch {}
      result = { ...jina, favicon, html, isMarkdown: true };
    } catch {
      // Fallback to direct fetch
      result = await fetchDirect(parsed);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

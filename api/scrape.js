export const config = { maxDuration: 25 };

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
    content: data.data?.content || '',
    description: data.data?.description || '',
  };
}

// Direct fetch fallback
async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const finalUrl = res.url || url;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&') : url;

  const faviconMatch = html.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i);
  let favicon = '';
  if (faviconMatch?.[1]) {
    try { favicon = new URL(faviconMatch[1], finalUrl).href; } catch {}
  }
  if (!favicon) { try { favicon = new URL('/favicon.ico', finalUrl).href; } catch {} }

  function toAbs(val) {
    if (!val || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('http')) return val;
    if (val.startsWith('//')) return 'https:' + val;
    try { return new URL(val, finalUrl).href; } catch { return val; }
  }

  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/\s+on\w+='[^']*'/gi, '')
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

    // Try Jina first (best quality, works on all sites)
    let result;
    try {
      const jina = await fetchViaJina(url);
      // Also get favicon and html via direct fetch
      let favicon = '';
      let html = '';
      try {
        const direct = await fetchDirect(url);
        favicon = direct.favicon;
        html = direct.html;
      } catch {}
      result = { ...jina, favicon, html, isMarkdown: true };
    } catch {
      // Fallback to direct fetch
      result = await fetchDirect(url);
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

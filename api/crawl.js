import { readJinaUrl } from './_jinaSearch.js';
import { fetchPublicUrl, validatePublicHttpUrl } from './_publicUrl.js';
import { guardRequest } from './_requestSecurity.js';

export const config = { maxDuration: 30 };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function validatePublicUrl(value = '') {
  return validatePublicHttpUrl(value)?.toString() || null;
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanPageText(html = '', limit = 24_000) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function directAccessStatus(status, text = '') {
  if (status === 401) return 'login-required';
  if (status === 403) return 'blocked';
  if (status === 429) return 'rate-limited';
  if (status >= 400) return 'unavailable';
  if (/\b(sign in|log in|login required|members only|authentication required)\b/i.test(text)) return 'login-required';
  if (/\b(access denied|forbidden|blocked by robots|captcha|permission denied)\b/i.test(text)) return 'blocked';
  return 'ok';
}

async function readLimitedText(response, maxBytes = 1_500_000) {
  if (!response.body?.getReader) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = Math.min(value.byteLength, maxBytes - total);
      output += decoder.decode(value.subarray(0, remaining), { stream: total + remaining < maxBytes });
      total += remaining;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return output;
}

async function readDirectUrl(url, signal) {
  try {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetchPublicUrl(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ResearchCrawler/1.0)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
      },
    });
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type && !/(text\/html|application\/xhtml\+xml|text\/plain)/.test(type)) {
      return { url, title: '', summary: '', content: '', links: [], status: response.status, accessStatus: 'unavailable', provider: 'direct-crawler' };
    }
    const raw = await readLimitedText(response);
    const title = cleanPageText(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 240);
    const description = cleanPageText(raw.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)?.[1]
      || raw.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1]
      || '', 1_000);
    const content = cleanPageText(raw);
    return {
      url,
      title,
      summary: description || content.slice(0, 2_400),
      content,
      links: [],
      status: response.status,
      accessStatus: directAccessStatus(response.status, content),
      provider: 'direct-crawler',
    };
  } catch (error) {
    return {
      url, title: '', summary: '', content: '', links: [], status: 0,
      accessStatus: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timed-out' : 'unavailable',
      provider: 'direct-crawler',
    };
  }
}

export async function POST(request) {
  const guarded = guardRequest(request, { limit: 15, windowMs: 60_000, key: 'crawl' });
  if (guarded) return guarded;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON request.' }, 400); }
  const urls = (Array.isArray(body?.urls) ? body.urls : [body?.url])
    .map(validatePublicUrl)
    .filter(Boolean)
    .slice(0, 5);
  if (!urls.length) return json({ error: 'At least one public HTTP(S) URL is required.' }, 400);

  const pages = await Promise.all(urls.map(async (url) => {
    const jinaPage = await readJinaUrl(url, { signal: request.signal });
    if (
      jinaPage
      && jinaPage.status !== 401
      && !['unavailable', 'timed-out', 'rate-limited'].includes(jinaPage.accessStatus)
    ) return jinaPage;
    return await readDirectUrl(url, request.signal);
  }));
  return json({ pages, crawledAt: new Date().toISOString() });
}

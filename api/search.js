export const config = { maxDuration: 20 };

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

function parseRSS(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.trim() || '';
    const desc = block.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    const rawLink = block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim()
      || block.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1]?.trim() || '';
    // Decode Bing redirect URLs to get real URL
    let url = rawLink;
    try {
      const u = new URL(rawLink);
      const real = u.searchParams.get('url') || u.searchParams.get('r');
      if (real) url = decodeURIComponent(real);
    } catch {}
    if (title.length > 3) items.push({ title, snippet: desc || title, url });
  }
  return items;
}

async function searchBrave(query) {
  if (!BRAVE_KEY) return null;
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&search_lang=en`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.web?.results || []).map(r => ({ title: r.title, snippet: r.description || r.title, url: r.url })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

async function searchGoogle(query) {
  if (!GOOGLE_KEY || !GOOGLE_CX) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=6`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.items || []).map(r => ({ title: r.title, snippet: r.snippet || r.title, url: r.link })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function searchBingNews(query) {
  try {
    const res = await fetch(
      `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchGoogleNews(query) {
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchDDG(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    const d = await res.json();
    const results = [];
    if (d.Answer) results.push({ title: 'Direct Answer', snippet: d.Answer, url: '' });
    if (d.AbstractText) results.push({ title: d.Heading || query, snippet: d.AbstractText, url: d.AbstractURL || '' });
    return results.length ? results : null;
  } catch { return null; }
}

export async function POST(req) {
  try {
    const { query } = await req.json();
    if (!query?.trim()) return new Response(JSON.stringify({ error: 'Query required', results: [] }), { status: 400 });

    const [brave, google, bing, gnews, ddg] = await Promise.all([
      searchBrave(query),
      searchGoogle(query),
      searchBingNews(query),
      searchGoogleNews(query),
      searchDDG(query),
    ]);

    // Paid APIs first
    if (brave?.length) return new Response(JSON.stringify({ results: brave.slice(0, 6), source: 'brave' }), { headers: { 'Content-Type': 'application/json' } });
    if (google?.length) return new Response(JSON.stringify({ results: google.slice(0, 6), source: 'google' }), { headers: { 'Content-Type': 'application/json' } });

    // Merge news + DDG, deduplicate
    const merged = [...(ddg || []), ...(bing || []), ...(gnews || [])];
    const seen = new Set();
    const results = merged.filter(r => {
      const key = r.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);

    return new Response(JSON.stringify({ results, source: results.length ? 'news-rss' : 'none' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, results: [] }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

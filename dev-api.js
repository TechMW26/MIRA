import http from 'http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseRSS(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.trim() || '';
    const desc = block.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    const rawLink = block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim()
      || block.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1]?.trim() || '';
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

async function handleScrape(body) {
  const { url } = JSON.parse(body);
  if (!url?.trim()) return { error: 'URL required' };

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.data?.content) {
        return {
          title: data.data.title || url,
          url: data.data.url || url,
          description: data.data.description || '',
          content: data.data.content,
          isMarkdown: true,
          favicon: `https://www.google.com/s2/favicons?domain=${new URL(data.data.url || url).hostname}&sz=32`,
          html: '',
        };
      }
    }
  } catch {}

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const finalUrl = res.url || url;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&') : url;

  function toAbs(val) {
    if (!val || val.startsWith('data:') || val.startsWith('http')) return val;
    if (val.startsWith('//')) return 'https:' + val;
    try { return new URL(val, finalUrl).href; } catch { return val; }
  }

  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/(\s+src=["'])([^"']+)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`)
    .replace(/(\s+href=["'])([^"'#][^"']*)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`);

  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ').trim();

  return {
    title, url: finalUrl, isMarkdown: false,
    favicon: `https://www.google.com/s2/favicons?domain=${new URL(finalUrl).hostname}&sz=32`,
    html: cleanHtml,
    content: plainText.slice(0, 20000),
    truncated: plainText.length > 20000,
  };
}

async function handleSearch(body) {
  const { query } = JSON.parse(body);
  if (!query?.trim()) return { error: 'Query required', results: [] };

  const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
  const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || '';

  const [braveRes, googleRes, bingRes, gnewsRes, ddgRes] = await Promise.allSettled([
    BRAVE_KEY ? fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    (GOOGLE_KEY && GOOGLE_CX) ? fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=6`, {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),
  ]);

<<<<<<< HEAD
=======
  // Paid APIs first
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
  const brave = braveRes.value?.web?.results;
  if (brave?.length) return { results: brave.slice(0, 6).map(r => ({ title: r.title, snippet: r.description || r.title, url: r.url })), source: 'brave' };

  const google = googleRes.value?.items;
  if (google?.length) return { results: google.slice(0, 6).map(r => ({ title: r.title, snippet: r.snippet || r.title, url: r.link })), source: 'google' };

  // News RSS
  const bing = bingRes.value ? parseRSS(bingRes.value) : [];
  const gnews = gnewsRes.value ? parseRSS(gnewsRes.value) : [];
  const ddgData = ddgRes.value;
  const ddg = [];
  if (ddgData?.Answer) ddg.push({ title: 'Direct Answer', snippet: ddgData.Answer, url: '' });
  if (ddgData?.AbstractText) ddg.push({ title: ddgData.Heading || query, snippet: ddgData.AbstractText, url: ddgData.AbstractURL || '' });

  const merged = [...ddg, ...bing, ...gnews];
  const seen = new Set();
  const results = merged.filter(r => {
    const key = r.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);

  return { results, source: results.length ? 'news-rss' : 'none' };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('{}'); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      let result;
      if (req.url === '/api/scrape') result = await handleScrape(body);
      else if (req.url === '/api/search') result = await handleSearch(body);
      else { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

<<<<<<< HEAD
function tryListen(startPort, attempts = 20) {
  const portEnv = process.env.PORT;
  const port = portEnv ? Number(portEnv) : startPort;

  let currentPort = port;
  let tries = 0;

  const attempt = () => {
    tries += 1;
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && tries < attempts) {
        currentPort += 1;
        console.log(`Dev API port ${currentPort - 1} in use, trying ${currentPort}...`);
        attempt();
        return;
      }
      throw err;
    });

    server.listen(currentPort, () => {
      console.log(`Dev API server running on http://localhost:${currentPort}`);
    });
  };

  attempt();
}

tryListen(3002);
=======
server.listen(3002, () => console.log('Dev API server running on http://localhost:3002'));
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020

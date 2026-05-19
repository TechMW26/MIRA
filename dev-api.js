import http from 'http';
import fs from 'fs';
import path from 'path';

// Lightweight .env loader (no extra deps). Loads KEY=VALUE pairs from ./.env
// into process.env if they aren't already defined.
(function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (e) {
    console.warn('dev-api: failed to load .env:', e.message);
  }
})();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// === Salad chat configuration ===
const SALAD_API_URL = process.env.SALAD_API_URL || process.env.API_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY || process.env.API_KEY;
const SALAD_MODEL = process.env.SALAD_MODEL || 'llama3.2-vision';
const SALAD_MAX_TOKENS = Number(process.env.SALAD_MAX_TOKENS || 2048);
const SALAD_TIMEOUT_MS = Number(process.env.SALAD_TIMEOUT_MS || 55000);

function imageToDataUrl(image) {
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw) return null;
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `data:${image?.mimeType || image?.type || 'image/jpeg'};base64,${raw}`;
}

function contentToParts(content) {
  if (Array.isArray(content)) return [...content];
  if (content == null) return [];
  return [{ type: 'text', text: String(content) }];
}

function withImages(messages, images = []) {
  const imageParts = images
    .map(imageToDataUrl)
    .filter(Boolean)
    .map((url) => ({ type: 'image_url', image_url: { url } }));
  if (imageParts.length === 0) return messages;

  const nextMessages = [...messages];
  let userIndex = -1;
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    if (nextMessages[index]?.role === 'user') {
      userIndex = index;
      break;
    }
  }

  if (userIndex === -1) {
    nextMessages.push({ role: 'user', content: imageParts });
    return nextMessages;
  }

  const target = nextMessages[userIndex];
  nextMessages[userIndex] = { ...target, content: [...contentToParts(target.content), ...imageParts] };
  return nextMessages;
}

function normalizeMessages(messages = [], systemPrompt) {
  const normalized = messages
    .filter((message) => message?.role && message.content != null)
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: message.content,
    }));
  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...normalized.filter((message) => message.role !== 'system')];
  }
  return normalized;
}

async function writeUpstreamBody(upstream, res) {
  const reader = upstream.body?.getReader();
  if (!reader) {
    res.end(await upstream.text());
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function handleChat(body, res) {
  if (!SALAD_API_URL || !SALAD_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Salad API URL or key is not configured.' }));
    return;
  }

  const payload = JSON.parse(body || '{}');
  const messages = withImages(normalizeMessages(payload.messages, payload.systemPrompt), payload.images);
  if (messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'At least one chat message is required.' }));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SALAD_TIMEOUT_MS);
  try {
    const upstream = await fetch(SALAD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Salad-Api-Key': SALAD_API_KEY,
      },
      body: JSON.stringify({
        model: payload.model || SALAD_MODEL,
        messages,
        stream: payload.stream !== false,
        max_tokens: payload.max_tokens || SALAD_MAX_TOKENS,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errorText || `Salad API error: ${upstream.status}` }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    await writeUpstreamBody(upstream, res);
  } catch (err) {
    clearTimeout(timeout);
    const message = err.name === 'AbortError' ? `Salad API timeout after ${SALAD_TIMEOUT_MS}ms` : err.message;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

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

  // Paid APIs first
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
      if (req.url === '/api/chat') { await handleChat(body, res); return; }

      let result;
      if (req.url === '/api/scrape') result = await handleScrape(body);
      else if (req.url === '/api/search') result = await handleSearch(body);
      else { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('[dev-api] handler error:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

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

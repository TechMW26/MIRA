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

// === Inference (chat + image) configuration ===
const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || 'http://142.112.39.215:50971';
const INFERENCE_PUBLIC_PATH = process.env.INFERENCE_PUBLIC_PATH || '/public/analyze';
const INFERENCE_PROTECTED_PATH = process.env.INFERENCE_PROTECTED_PATH || '/v1/analyze';
const INFERENCE_APP_TOKEN = process.env.INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || 'PRO_SAFETY_TOKEN_2026';
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS || 35000);
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'http://142.112.39.215:50978';
const IMAGE_GENERATE_PATH = process.env.IMAGE_GENERATE_PATH || '/generate';

const PLACEHOLDER_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

function buildFileFromImage(image) {
  const mimeType = image?.mimeType || 'image/jpeg';
  const base64 = image?.base64 || '';
  if (!base64) return null;
  const sanitized = base64.includes(',') ? base64.split(',')[1] : base64;
  const bytes = Buffer.from(sanitized, 'base64');
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const blob = new Blob([bytes], { type: mimeType });
  return { blob, filename: `upload.${ext}` };
}

function buildPlaceholderFile() {
  const bytes = Buffer.from(PLACEHOLDER_JPEG_BASE64, 'base64');
  return { blob: new Blob([bytes], { type: 'image/jpeg' }), filename: 'placeholder.jpg' };
}

function buildInferenceFormData(prompt, image) {
  const file = buildFileFromImage(image) || buildPlaceholderFile();
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('file', file.blob, file.filename);
  return formData;
}

function getLastUserPrompt(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) {
      return String(messages[i].content).trim();
    }
  }
  return '';
}

async function callInferenceEndpoint(baseUrl, paths, prompt, image) {
  const attempts = [];
  if (INFERENCE_API_KEY) {
    attempts.push({ url: `${baseUrl}${paths.protected}`, headers: { 'X-API-KEY': INFERENCE_API_KEY } });
  }
  attempts.push({ url: `${baseUrl}${paths.public}`, headers: { 'X-App-Token': INFERENCE_APP_TOKEN || '' } });

  let lastError = 'Inference provider unavailable.';
  for (const attempt of attempts) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: attempt.headers,
        body: buildInferenceFormData(prompt, image),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload?.result) return { ok: true, status: 200, payload };
      lastError = payload?.error || payload?.message || `Inference error: ${res.status}`;
      console.warn(`[dev-api] Inference ${attempt.url} failed ${res.status}: ${lastError}`);
    } catch (err) {
      lastError = err.name === 'AbortError' ? `Inference timeout after ${INFERENCE_TIMEOUT_MS}ms` : err.message;
      console.warn('[dev-api] Inference request failed:', err.message);
    }
  }
  return { ok: false, status: 503, error: lastError };
}

async function handleChat(body, res) {
  const { messages = [], images = [] } = JSON.parse(body || '{}');
  const prompt = getLastUserPrompt(messages);
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Prompt is required.' }));
    return;
  }
  const inference = await callInferenceEndpoint(
    INFERENCE_BASE_URL,
    { protected: INFERENCE_PROTECTED_PATH, public: INFERENCE_PUBLIC_PATH },
    prompt,
    image,
  );
  if (!inference.ok) {
    res.writeHead(inference.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: inference.error }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ text: inference.payload.result })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleImage(body, res) {
  const { prompt, images = [] } = JSON.parse(body || '{}');
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'prompt is required' }));
    return;
  }
  const inference = await callInferenceEndpoint(
    IMAGE_BASE_URL,
    { protected: IMAGE_GENERATE_PATH, public: IMAGE_GENERATE_PATH },
    prompt,
    image,
  );
  if (!inference.ok) {
    res.writeHead(inference.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: inference.error }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    inference_type: inference.payload.inference_type,
    model: inference.payload.model,
    result: inference.payload.result,
    execution_time_ms: inference.payload.execution_time_ms,
    provider: 'custom-vision-endpoint',
  }));
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
      if (req.url === '/api/image') { await handleImage(body, res); return; }

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

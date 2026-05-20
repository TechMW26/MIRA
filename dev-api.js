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
const ANCHOR_STOP = new Set(['the','a','an','of','to','for','in','on','with','and','or','but','is','are','was','were','what','how','why','when','where','this','that','it','its','they','them','about','more','can','you','tell','please','show','give','find','search','get','some','image','images','photo','picture','video','videos','media','device','product','object','thing','system','technology']);

function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/["'`“”‘’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value = '') {
  return normalizeSearchText(value).split(' ').filter((word) => word.length >= 3 && !ANCHOR_STOP.has(word));
}

function extractAnchorPhrase(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const quoted = text.match(/["“]([^"”]{2,80})["”]/)?.[1]?.trim();
  if (quoted) return quoted;
  const title = text.match(/\b[A-Z][A-Za-z0-9&+.-]*(?:\s+[A-Z][A-Za-z0-9&+.-]*){1,5}\b/)?.[0]?.trim();
  if (title) return title.replace(/^(?:the|a|an)\s+/i, '');
  return text.split(/[,;|:()]/)[0].trim().split(/\s+/).slice(0, 4).join(' ');
}

function buildAnchorScope(anchor = '') {
  const phrase = extractAnchorPhrase(anchor);
  const terms = Array.from(new Set(searchTokens(phrase || anchor))).slice(0, 6);
  return { phrase, phraseNorm: normalizeSearchText(phrase), terms };
}

function anchorThreshold(scope) {
  return scope?.terms?.length >= 2 ? 2 : 1;
}

function scoreAgainstAnchor(text = '', scope) {
  if (!scope?.terms?.length) return 0;
  const haystack = normalizeSearchText(text);
  if (!haystack) return 0;
  let score = scope.phraseNorm && haystack.includes(scope.phraseNorm) ? 10 : 0;
  for (const term of scope.terms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function filterByAnchor(items, scope, getText, strict = false) {
  if (!Array.isArray(items) || !items.length || !scope?.terms?.length) return items || [];
  const scored = items.map((item) => ({ item, score: scoreAgainstAnchor(getText(item), scope) }));
  const exact = scored.filter((entry) => scope.phraseNorm && entry.score >= 10);
  if (exact.length) return exact.map((entry) => entry.item);
  if (!strict) return items;
  return scored.filter((entry) => entry.score >= anchorThreshold(scope)).map((entry) => entry.item);
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanImageText(value = '') {
  return decodeHtmlEntities(value)
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBingImageMetadata(html = '', query = '', anchorScope = null, strictAnchor = false) {
  const items = [];
  const seen = new Set();
  const tags = html.match(/<a\b(?=[^>]*\biusc\b)[^>]*>/gi) || [];
  for (const tag of tags) {
    const attr = tag.match(/\bm=(['"])(.*?)\1/i)?.[2];
    if (!attr) continue;
    let meta;
    try {
      meta = JSON.parse(decodeHtmlEntities(attr));
    } catch {
      continue;
    }
    const original = meta.murl || '';
    const thumbnail = meta.turl || original;
    const source = meta.purl || `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
    const title = cleanImageText(meta.t || meta.desc || '');
    const desc = cleanImageText(meta.desc || '');
    const key = original || thumbnail;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      url: original || thumbnail,
      thumbnail,
      title,
      source,
      _score: scoreAgainstAnchor(`${title} ${desc} ${source} ${original}`, anchorScope),
    });
  }

  const filtered = strictAnchor
    ? filterByAnchor(items, anchorScope, (im) => `${im.title || ''} ${im.source || ''} ${im.url || ''}`, true)
    : items;

  return filtered.map(({ _score, ...item }) => item);
}

function imageQueryVariants(query = '', anchorScope = null) {
  const unquoted = String(query || '').replace(/["“”]/g, '').trim();
  const phrase = anchorScope?.phrase || '';
  return Array.from(new Set([
    unquoted,
    query,
    phrase,
    phrase ? `${phrase} photo` : '',
    phrase ? `${phrase} images` : '',
  ].filter(Boolean)));
}

function buildResultAnchoredImageQuery(results = [], anchorScope = null, fallback = '') {
  if (!anchorScope?.terms?.length) return fallback;
  const hit = (results || []).find((result) => scoreAgainstAnchor(`${result.title || ''} ${result.snippet || ''}`, anchorScope) >= 10)
    || (results || []).find((result) => scoreAgainstAnchor(`${result.title || ''} ${result.snippet || ''}`, anchorScope) >= anchorThreshold(anchorScope));
  if (!hit?.title) return fallback;
  const cleaned = cleanImageText(hit.title)
    .replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/g, '')
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .slice(0, 10)
    .join(' ')
    .trim();
  return cleaned || fallback;
}

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

function normalizeMessages(messages = [], systemPrompt) {
  const normalized = messages
    .filter((message) => message?.role && message.content != null)
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: typeof message.content === 'string' ? message.content : String(message.content || ''),
    }));
  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...normalized.filter((message) => message.role !== 'system')];
  }
  return normalized;
}

// Ollama vision (llama3.2-vision) requires images attached to the user
// message as `images: [base64, ...]` (raw base64 only).
function imageToOllamaBase64(image) {
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return null;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    return comma >= 0 ? raw.slice(comma + 1) : null;
  }
  return raw;
}

function attachImagesToLastUserMessage(messages, images) {
  if (!Array.isArray(images) || images.length === 0) return messages;
  const base64List = images.map(imageToOllamaBase64).filter(Boolean);
  if (base64List.length === 0) return messages;
  const copy = messages.map((m) => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'user') {
      copy[i] = { ...copy[i], images: base64List };
      return copy;
    }
  }
  copy.push({ role: 'user', content: '', images: base64List });
  return copy;
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
  const imageList = Array.isArray(payload.images) ? payload.images.slice(0, 6) : [];
  const baseMessages = normalizeMessages(payload.messages, payload.systemPrompt);
  const messages = attachImagesToLastUserMessage(baseMessages, imageList);
  if (messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'At least one chat message is required.' }));
    return;
  }

  const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
  const requestedModel = payload.model || SALAD_MODEL;
  const effectiveModel = hasImages ? 'llama3.2-vision' : requestedModel;

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
        model: effectiveModel,
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
    const cleanLink = rawLink.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    let url = cleanLink;
    try {
      const u = new URL(cleanLink);
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
  const { query, includeMedia = true, mediaQuery, anchor, strictAnchor = false } = JSON.parse(body);
  if (!query?.trim()) return { error: 'Query required', results: [], media: { videos: [], images: [] } };
  const searchQuery = query.trim();
  const mediaSearchQuery = String(mediaQuery || searchQuery).trim();
  const anchorScope = buildAnchorScope(anchor || (strictAnchor ? mediaSearchQuery : ''));
  const shouldFetchMedia = includeMedia !== false;

  const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
  const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || '';

  const decodeYTText = (s = '') => s.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');

  const YT_BLOCKLIST = new Set([
    'dQw4w9WgXcQ', 'oHg5SJYRHA0', 'xvFZjo5PgG0', 'iik25wqIuFo',
  ]);
  const YT_STOP = new Set(['the','a','an','of','to','for','in','on','with','and','or','but','is','are','was','were','what','how','why','when','where','this','that','it','its','they','them','about','more','can','you','tell','me','please','show','give','find','search','get','some']);
  const ytQueryKeywords = (q) => (q || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !YT_STOP.has(w));

  const youtubePromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const wantsFresh = /\b(latest|current|new|recent|today|this\s+year|202[5-9])\b/i.test(mediaSearchQuery);
      const currentYear = new Date().getUTCFullYear();
      const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(mediaSearchQuery)}&sp=CAMSAhAB`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const html = await r.text();
      // Only parse real "videoRenderer" blocks (actual search results),
      // skipping the recommendations sidebar that loves to surface rickrolls.
      const blocks = html.split('"videoRenderer":').slice(1, 30);
      const seen = new Set();
      const collected = [];
      for (const raw of blocks) {
        const slice = raw.slice(0, 6000);
        const idM = slice.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (!idM) continue;
        const id = idM[1];
        if (seen.has(id) || YT_BLOCKLIST.has(id)) continue;
        const tM = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)
              || slice.match(/"title":\{"simpleText":"([^"]+)"/)
              || slice.match(/"title":\{"accessibility":[\s\S]*?"simpleText":"([^"]+)"/);
        const title = tM ? decodeYTText(tM[1]) : '';
        const pM = slice.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)
              || slice.match(/"publishedTimeText":\{"runs":\[\{"text":"([^"]+)"/);
        const published = pM ? decodeYTText(pM[1]) : '';
        if (wantsFresh) {
          const ageText = `${title} ${published}`.toLowerCase();
          const year = Number(ageText.match(/\b(20\d{2})\b/)?.[1] || 0);
          const yearsAgo = Number(ageText.match(/\b(\d+)\s+years?\s+ago\b/)?.[1] || 0);
          if ((year && year < currentYear - 1) || yearsAgo > 1) continue;
        }
        seen.add(id);
        collected.push({ id, title, published });
      }
      const kw = ytQueryKeywords(mediaSearchQuery);
      let filtered = collected;
      if (strictAnchor && anchorScope?.terms?.length) {
        const scored = collected.map((v) => ({ ...v, score: scoreAgainstAnchor(v.title, anchorScope) }));
        const exact = scored.filter((v) => anchorScope.phraseNorm && v.score >= 10);
        filtered = exact.length ? exact : scored.filter((v) => v.score >= anchorThreshold(anchorScope));
      } else if (kw.length) {
        const weak = new Set(['know', 'which', 'latest', 'current', 'recent', 'video', 'videos', 'media', 'image', 'images']);
        const meaningful = kw.filter((w) => !weak.has(w));
        const required = meaningful.length >= 2 ? 2 : 1;
        const score = (t) => meaningful.reduce((n, w) => n + ((t || '').toLowerCase().includes(w) ? 1 : 0), 0);
        const strict = collected.map((v) => ({ ...v, s: score(v.title) })).filter((v) => v.s >= required);
        if (strict.length) filtered = strict;
      }
      return filtered.slice(0, 6).map(({ id, title }) => ({
        platform: 'youtube',
        videoId: id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        embed: `https://www.youtube.com/embed/${id}`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }));
    } catch { return null; }
  })();

  const instagramPromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:instagram.com ${mediaSearchQuery}`)}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const html = await r.text();
      const re = /instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/g;
      const seen = new Set();
      const out = [];
      let m;
      while ((m = re.exec(html)) !== null && out.length < 3) {
        const kind = m[1];
        const id = m[2];
        const key = `${kind}/${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          platform: 'instagram',
          videoId: id,
          title: `Instagram ${kind === 'reel' ? 'Reel' : 'Post'}`,
          url: `https://www.instagram.com/${kind}/${id}/`,
          embed: `https://www.instagram.com/${kind}/${id}/embed/`,
          thumbnail: '',
        });
      }
      return out.length ? out : null;
    } catch { return null; }
  })();

  const bingImagesPromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const variants = imageQueryVariants(mediaSearchQuery, anchorScope);
      const re = /https:\/\/tse\d\.mm\.bing\.net\/th\/id\/[A-Za-z0-9._-]+(?:\?[^"'\s)<>]+)?/g;
      for (const variant of variants) {
        const r = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(variant)}&form=HDRSC2&first=1`, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) continue;
        const html = await r.text();
        const metadataImages = parseBingImageMetadata(html, variant, anchorScope, strictAnchor);
        if (metadataImages.length) return metadataImages.slice(0, 6);
        if (strictAnchor) continue;
        const seen = new Set();
        const out = [];
        for (const m of html.matchAll(re)) {
          const url = m[0];
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ url, thumbnail: url, title: '', source: `https://www.bing.com/images/search?q=${encodeURIComponent(variant)}` });
          if (out.length >= 6) break;
        }
        if (out.length) return out;
      }
      return null;
    } catch { return null; }
  })();

  const [braveRes, googleRes, bingRes, gnewsRes, ddgRes, videosRes, imagesRes, instagramRes] = await Promise.allSettled([
    BRAVE_KEY ? fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=6`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    (GOOGLE_KEY && GOOGLE_CX) ? fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}&num=6`, {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(searchQuery)}&format=rss`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),

    youtubePromise,
    bingImagesPromise,
    instagramPromise,
  ]);

  // Helper: extract og:image / og:video from an article URL.
  const extractOg = (html, baseUrl) => {
    const pick = (re) => {
      const m = html.match(re);
      if (!m) return '';
      const raw = m[1].replace(/&amp;/g, '&');
      try { return new URL(raw, baseUrl).toString(); } catch { return ''; }
    };
    const image =
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const video =
      pick(/<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
    const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 140);
    return { image, video, title };
  };

  const enrichFromArticles = async (results) => {
    const top = (results || []).filter((r) => r.url && /^https?:\/\//i.test(r.url)).slice(0, 4);
    if (!top.length) return { images: [], videos: [] };
    const fetched = await Promise.all(top.map(async (r) => {
      try {
        const res = await fetch(r.url, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (!/text\/html/i.test(ct)) return null;
        const html = (await res.text()).slice(0, 250000);
        return { html, source: r };
      } catch { return null; }
    }));
    const images = [];
    const videos = [];
    const seenImg = new Set();
    const seenVid = new Set();
    for (const f of fetched) {
      if (!f) continue;
      const og = extractOg(f.html, f.source.url);
      if (og.image && !seenImg.has(og.image)) {
        seenImg.add(og.image);
        images.push({ url: og.image, thumbnail: og.image, title: og.title || f.source.title || '', source: f.source.url });
      }
      if (og.video && !seenVid.has(og.video)) {
        seenVid.add(og.video);
        videos.push({ platform: 'article', url: og.video, embed: og.video, thumbnail: og.image || '', title: og.title || f.source.title || '' });
      }
    }
    return { images, videos };
  };

  // Decide the primary `results` list, then enrich.
  let results;
  let source;
  const brave = braveRes.value?.web?.results;
  const google = googleRes.value?.items;
  if (brave?.length) {
    results = brave.slice(0, 6).map(r => ({ title: r.title, snippet: r.description || r.title, url: r.url }));
    source = 'brave';
  } else if (google?.length) {
    results = google.slice(0, 6).map(r => ({ title: r.title, snippet: r.snippet || r.title, url: r.link }));
    source = 'google';
  } else {
    const bing = bingRes.value ? parseRSS(bingRes.value) : [];
    const gnews = gnewsRes.value ? parseRSS(gnewsRes.value) : [];
    const ddgData = ddgRes.value;
    const ddg = [];
    if (ddgData?.Answer) ddg.push({ title: 'Direct Answer', snippet: ddgData.Answer, url: '' });
    if (ddgData?.AbstractText) ddg.push({ title: ddgData.Heading || searchQuery, snippet: ddgData.AbstractText, url: ddgData.AbstractURL || '' });
    const merged = [...ddg, ...bing, ...gnews];
    const seen = new Set();
    results = merged.filter(r => {
      const key = r.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
    source = results.length ? 'news-rss' : 'none';
  }

  if (strictAnchor) {
    results = filterByAnchor(results, anchorScope, (r) => `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`, true);
  }

  // Validate URLs: drop dead/404 article links before they reach the model or UI.
  if (results?.length) {
    const checks = await Promise.all(results.map(async (r) => {
      if (!r?.url || !/^https?:/i.test(r.url)) return r;
      try {
        const resp = await fetch(r.url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(3500),
        });
        if (resp.status === 405 || resp.status === 403) return r; // server blocks HEAD
        return resp.status < 400 ? r : null;
      } catch { return r; }
    }));
    results = checks.filter(Boolean);
  }

  let resolvedBingImages = imagesRes.value || [];
  if (shouldFetchMedia && strictAnchor) {
    const resultImageQuery = buildResultAnchoredImageQuery(results, anchorScope, mediaSearchQuery);
    if (resultImageQuery && resultImageQuery !== mediaSearchQuery) {
      const resultAnchoredImages = await (async () => {
        try {
          const variants = imageQueryVariants(resultImageQuery, anchorScope);
          for (const variant of variants) {
            const r = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(variant)}&form=HDRSC2&first=1`, {
              headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) continue;
            const metadataImages = parseBingImageMetadata(await r.text(), variant, anchorScope, true);
            if (metadataImages.length) return metadataImages.slice(0, 6);
          }
        } catch {}
        return null;
      })();
      if (Array.isArray(resultAnchoredImages) && resultAnchoredImages.length) {
        resolvedBingImages = resultAnchoredImages;
      }
    }
  }

  const og = await enrichFromArticles(results);

  // Image ordering: article og:image (most relevant) → Bing CDN thumbs (filler).
  const ytVideos = videosRes.value || [];
  const bingImgs = resolvedBingImages;
  const igVideos = instagramRes.value || [];

  const seenImg = new Set();
  const mergedImages = [];
  for (const im of [...og.images, ...bingImgs]) {
    if (!im.url || seenImg.has(im.url)) continue;
    seenImg.add(im.url);
    mergedImages.push(im);
    if (mergedImages.length >= 8) break;
  }

  const seenVid = new Set();
  const mergedVideos = [];
  for (const v of [...ytVideos, ...igVideos, ...og.videos]) {
    const key = v.url || v.embed;
    if (!key || seenVid.has(key)) continue;
    seenVid.add(key);
    mergedVideos.push(v);
    if (mergedVideos.length >= 8) break;
  }

  const media = { videos: mergedVideos, images: mergedImages };
  return { results, media, source };
}

// === Image proxy (dev parity with api/image.js) ===
const IMG_MAX_BYTES = 8 * 1024 * 1024;
const IMG_ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/i;

function imgIsPrivateHost(h) {
  if (!h) return true;
  h = h.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
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

async function handleImageProxy(req, res) {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const target = parsed.searchParams.get('url') || '';
    let url;
    try { url = new URL(target.trim()); } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid URL' })); return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || imgIsPrivateHost(url.hostname)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Disallowed URL' })); return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageProxy/1.0)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
      },
    });
    clearTimeout(timeout);
    if (!upstream.ok) {
      res.writeHead(502); res.end(JSON.stringify({ error: `Upstream ${upstream.status}` })); return;
    }
    const ct = upstream.headers.get('content-type') || '';
    if (!IMG_ALLOWED_MIME.test(ct.split(';')[0].trim())) {
      res.writeHead(415); res.end(JSON.stringify({ error: `Unsupported content-type: ${ct}` })); return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > IMG_MAX_BYTES) {
      res.writeHead(413); res.end(JSON.stringify({ error: 'Image too large' })); return;
    }
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buffer);
  } catch (err) {
    res.writeHead(504); res.end(JSON.stringify({ error: err?.message || 'Image fetch failed' }));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // GET /api/image?url=... — image proxy for CORS-blocked sources
  if (req.method === 'GET' && req.url?.startsWith('/api/image')) {
    await handleImageProxy(req, res);
    return;
  }

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

function tryListen(startPort) {
  const portEnv = process.env.PORT;
  const port = portEnv ? Number(portEnv) : startPort;

  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Dev API port ${port} is already in use. Stop the old dev server and run npm run dev again; Vite proxies /api/* to this exact port.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`Dev API server running on http://localhost:${port}`);
  });
}

tryListen(3002);

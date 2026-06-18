export const config = { maxDuration: 20 };

import {
  detectFreshnessIntent,
  extractGooglePublishedAt,
  freshnessWindow,
  normalizePublishedAt,
  rankFreshResults,
} from './_searchFreshness.js';

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
    const publishedAt = normalizePublishedAt(
      block.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]
      || block.match(/<dc:date>([^<]+)<\/dc:date>/i)?.[1]
      || '',
    );
    const cleanLink = rawLink.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Decode Bing redirect URLs to get real URL
    let url = cleanLink;
    try {
      const u = new URL(cleanLink);
      const real = u.searchParams.get('url') || u.searchParams.get('r');
      if (real) url = decodeURIComponent(real);
    } catch {}
    if (title.length > 3) items.push({ title, snippet: desc || title, url, ...(publishedAt ? { publishedAt } : {}) });
  }
  return items;
}

async function searchBrave(query, fresh = false, window = freshnessWindow(query)) {
  if (!BRAVE_KEY) return null;
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&search_lang=en${fresh ? `&freshness=${window.brave}` : ''}`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.web?.results || []).map(r => ({
      title: r.title,
      snippet: r.description || r.title,
      url: r.url,
      ...(normalizePublishedAt(r.page_age || r.age || r.published || '') ? { publishedAt: normalizePublishedAt(r.page_age || r.age || r.published || '') } : {}),
    })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

async function searchGoogle(query, fresh = false, window = freshnessWindow(query)) {
  if (!GOOGLE_KEY || !GOOGLE_CX) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10${fresh ? `&dateRestrict=${window.google}&sort=date` : ''}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.items || []).map(r => ({
      title: r.title,
      snippet: r.snippet || r.title,
      url: r.link,
      ...(extractGooglePublishedAt(r) ? { publishedAt: extractGooglePublishedAt(r) } : {}),
    })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

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

async function searchBingWeb(query) {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 8);
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

// === Media: YouTube + Bing Images scrapers ===
function decodeYTText(s = '') {
  return s.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');
}

// Known spam / meme / rickroll ids YouTube loves to suggest in the
// recommendations sidebar — never surface these as "results".
const YT_BLOCKLIST = new Set([
  'dQw4w9WgXcQ', // Rick Astley — Never Gonna Give You Up
  'oHg5SJYRHA0', // RickRoll'D mirror
  'xvFZjo5PgG0', // duck song
  'iik25wqIuFo', // longplay rickroll mirror
]);

function ytQueryKeywords(query) {
  const STOP = new Set(['the','a','an','of','to','for','in','on','with','and','or','but','is','are','was','were','what','how','why','when','where','this','that','it','its','they','them','about','more','can','you','tell','me','please','show','give','find','search','get','some']);
  return (query || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

async function searchYouTube(query, anchorScope = null, strictAnchor = false) {
  try {
    const wantsFresh = /\b(latest|current|new|recent|today|this\s+year|202[5-9])\b/i.test(query);
    const currentYear = new Date().getUTCFullYear();
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAMSAhAB`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const html = await res.text();
    // Only parse genuine "videoRenderer" blocks (actual search results).
    // This skips compactVideoRenderer / promotedVideoRenderer in the
    // recommendations sidebar where rickrolls and unrelated trends live.
    const blocks = html.split('"videoRenderer":').slice(1, 30);
    const seen = new Set();
    const out = [];
    for (const raw of blocks) {
      const slice = raw.slice(0, 6000);
      const idM = slice.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (!idM) continue;
      const id = idM[1];
      if (seen.has(id) || YT_BLOCKLIST.has(id)) continue;
      const titleM = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)
                  || slice.match(/"title":\{"simpleText":"([^"]+)"/)
                  || slice.match(/"title":\{"accessibility":[\s\S]*?"simpleText":"([^"]+)"/);
      const title = titleM ? decodeYTText(titleM[1]) : '';
      const publishedM = slice.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)
                      || slice.match(/"publishedTimeText":\{"runs":\[\{"text":"([^"]+)"/);
      const published = publishedM ? decodeYTText(publishedM[1]) : '';
      if (wantsFresh) {
        const ageText = `${title} ${published}`.toLowerCase();
        const year = Number(ageText.match(/\b(20\d{2})\b/)?.[1] || 0);
        const yearsAgo = Number(ageText.match(/\b(\d+)\s+years?\s+ago\b/)?.[1] || 0);
        if ((year && year < currentYear - 1) || yearsAgo > 1) continue;
      }
      seen.add(id);
      out.push({ id, title, published });
    }
    // Relevance filter: keep results whose title overlaps the query keywords.
    // If none overlap (rare — usually a navigational query), fall back to raw order.
    const kw = ytQueryKeywords(query);
    let filtered = out;
    if (strictAnchor && anchorScope?.terms?.length) {
      const scored = out.map((v) => ({ ...v, score: scoreAgainstAnchor(v.title, anchorScope) }));
      const exact = scored.filter((v) => anchorScope.phraseNorm && v.score >= 10);
      filtered = exact.length ? exact : scored.filter((v) => v.score >= anchorThreshold(anchorScope));
    } else if (kw.length) {
      const weak = new Set(['know', 'which', 'latest', 'current', 'recent', 'video', 'videos', 'media', 'image', 'images']);
      const meaningful = kw.filter((w) => !weak.has(w));
      const required = meaningful.length >= 2 ? 2 : 1;
      const matchScore = (t) => {
        const lt = (t || '').toLowerCase();
        return meaningful.reduce((n, w) => n + (lt.includes(w) ? 1 : 0), 0);
      };
      const scored = out.map((v) => ({ ...v, score: matchScore(v.title) }));
      const relevant = scored.filter((v) => v.score >= required);
      if (relevant.length) filtered = relevant;
    }
    const final = filtered.slice(0, 6).map(({ id, title }) => ({
      platform: 'youtube',
      videoId: id,
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      embed: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }));
    return final.length ? final : null;
  } catch { return null; }
}

// Drop dead / 404 article URLs before sending to the model and the UI.
// Lightweight HEAD with 3s timeout; servers that block HEAD (405) are kept.
async function validateUrls(items) {
  if (!Array.isArray(items) || !items.length) return items || [];
  const checks = items.map(async (r) => {
    if (!r?.url || !/^https?:/i.test(r.url)) return { r, ok: true };
    try {
      const resp = await fetch(r.url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(3500),
      });
      // Treat 405 (HEAD not allowed) and 403 (some bot walls) as "probably fine".
      if (resp.status === 405 || resp.status === 403) return { r, ok: true };
      return { r, ok: resp.status < 400 };
    } catch {
      return { r, ok: true }; // network blip — don't punish, model can still cite
    }
  });
  const settled = await Promise.all(checks);
  return settled.filter((x) => x.ok).map((x) => x.r);
}

// === Instagram via DuckDuckGo HTML search ===
// DDG indexes /p/ and /reel/ URLs reasonably well; Bing aggressively blocks
// site: queries. We embed via Instagram's own /embed endpoint.
async function searchInstagram(query) {
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:instagram.com ${query}`)}`;
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
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
}

// === Open-Graph media extraction from already-returned article URLs ===
// These yield the most topic-relevant images (and sometimes videos), because
// each article URL is already a known-good search hit for the user's query.
function extractOgMedia(html, baseUrl) {
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
  const title =
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 140);
  return { image, video, title };
}

async function enrichFromArticles(results) {
  const articleHits = (results || []).filter((r) => r.url && /^https?:\/\//i.test(r.url)).slice(0, 4);
  if (!articleHits.length) return { images: [], videos: [] };
  const fetched = await Promise.all(articleHits.map(async (r) => {
    try {
      const res = await fetch(r.url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!/text\/html/i.test(ct)) return null;
      // Cap body size to avoid huge pages.
      const reader = res.body?.getReader?.();
      if (!reader) {
        const html = (await res.text()).slice(0, 250000);
        return { html, source: r };
      }
      let received = 0;
      const chunks = [];
      while (received < 250000) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
      }
      try { reader.cancel(); } catch { /* no-op */ }
      const html = new TextDecoder().decode(
        chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((c) => Buffer.from(c)))
      );
      return { html, source: r };
    } catch { return null; }
  }));

  const images = [];
  const videos = [];
  const seenImg = new Set();
  const seenVid = new Set();
  for (const f of fetched) {
    if (!f) continue;
    const og = extractOgMedia(f.html, f.source.url);
    if (og.image && !seenImg.has(og.image)) {
      seenImg.add(og.image);
      images.push({
        url: og.image,
        thumbnail: og.image,
        title: og.title || f.source.title || '',
        source: f.source.url,
      });
    }
    if (og.video && !seenVid.has(og.video)) {
      seenVid.add(og.video);
      videos.push({
        platform: 'article',
        url: og.video,
        embed: og.video, // direct mp4/iframe URL
        thumbnail: og.image || '',
        title: og.title || f.source.title || '',
      });
    }
  }
  return { images, videos };
}

async function searchBingImages(query, anchorScope = null, strictAnchor = false) {
  try {
    const variants = imageQueryVariants(query, anchorScope);
    const re = /https:\/\/tse\d\.mm\.bing\.net\/th\/id\/[A-Za-z0-9._-]+(?:\?[^"'\s)<>]+)?/g;
    for (const variant of variants) {
      const res = await fetch(
        `https://www.bing.com/images/search?q=${encodeURIComponent(variant)}&form=HDRSC2&first=1`,
        { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const html = await res.text();
      const metadataImages = parseBingImageMetadata(html, variant, anchorScope, strictAnchor);
      if (metadataImages.length) return metadataImages.slice(0, 6);
      if (strictAnchor) continue;
      // Bing serves image previews from tse[0-9].mm.bing.net CDN. These URLs are
      // hot-linkable, render fine in <img>, and survive Bing's anti-scraping HTML
      // changes (the structured m="{...}" attribute is no longer reliable).
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
}

export async function POST(req) {
  try {
    const { query, includeMedia = true, mediaQuery, anchor, strictAnchor = false, freshness = false } = await req.json();
    if (!query?.trim()) return new Response(JSON.stringify({ error: 'Query required', results: [] }), { status: 400 });
    const searchQuery = query.trim();
    const mediaSearchQuery = String(mediaQuery || searchQuery).trim();
    const anchorScope = buildAnchorScope(anchor || (strictAnchor ? mediaSearchQuery : ''));
    const shouldFetchMedia = includeMedia !== false;
    const fresh = detectFreshnessIntent(searchQuery, freshness);
    const window = freshnessWindow(searchQuery);

    const [brave, google, bingWeb, bing, gnews, ddg, videos, bingImages, instagram] = await Promise.all([
      searchBrave(searchQuery, fresh, window),
      searchGoogle(searchQuery, fresh, window),
      searchBingWeb(searchQuery),
      searchBingNews(searchQuery),
      searchGoogleNews(searchQuery),
      searchDDG(searchQuery),
      shouldFetchMedia ? searchYouTube(mediaSearchQuery, anchorScope, strictAnchor) : Promise.resolve(null),
      shouldFetchMedia ? searchBingImages(mediaSearchQuery, anchorScope, strictAnchor) : Promise.resolve(null),
      shouldFetchMedia ? searchInstagram(mediaSearchQuery) : Promise.resolve(null),
    ]);

    // Decide the primary `results` list, then enrich images/videos by scraping
    // og:image / og:video from the top article URLs (highest relevance media).
    let results;
    let source;
    if (fresh) {
      results = rankFreshResults([...(brave || []), ...(google || []), ...(bing || []), ...(gnews || []), ...(bingWeb || [])], window);
      source = results.length ? 'fresh-mixed' : 'none';
    } else if (brave?.length) { results = brave.slice(0, 6); source = 'brave'; }
    else if (google?.length) { results = google.slice(0, 6); source = 'google'; }
    else {
      const merged = [...(ddg || []), ...(bingWeb || []), ...(bing || []), ...(gnews || [])];
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

    // Drop dead/404 article URLs before sending them to the model or UI.
    results = await validateUrls(results);

    let resolvedBingImages = bingImages || [];
    if (shouldFetchMedia && strictAnchor) {
      const resultImageQuery = buildResultAnchoredImageQuery(results, anchorScope, mediaSearchQuery);
      if (resultImageQuery && resultImageQuery !== mediaSearchQuery) {
        const resultAnchoredImages = await searchBingImages(resultImageQuery, anchorScope, true);
        if (Array.isArray(resultAnchoredImages) && resultAnchoredImages.length) {
          resolvedBingImages = resultAnchoredImages;
        }
      }
    }

    const og = await enrichFromArticles(results);

    // Image ordering: article og:image (most relevant) → Bing CDN thumbs (filler).
    const seenImg = new Set();
    const mergedImages = [];
    for (const im of [...og.images, ...resolvedBingImages]) {
      if (!im.url || seenImg.has(im.url)) continue;
      seenImg.add(im.url);
      mergedImages.push(im);
      if (mergedImages.length >= 8) break;
    }

    // Video ordering: YouTube → Instagram → article-embedded videos.
    const seenVid = new Set();
    const mergedVideos = [];
    for (const v of [...(videos || []), ...(instagram || []), ...og.videos]) {
      const key = v.url || v.embed;
      if (!key || seenVid.has(key)) continue;
      seenVid.add(key);
      mergedVideos.push(v);
      if (mergedVideos.length >= 8) break;
    }

    const media = { videos: mergedVideos, images: mergedImages };
    return new Response(JSON.stringify({
      results,
      media,
      source,
      freshness: {
        requested: fresh,
        maxAgeDays: fresh ? window.maxAgeDays : null,
        newestPublishedAt: results.find((result) => result.publishedAt)?.publishedAt || '',
        retrievedAt: new Date().toISOString(),
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, results: [], media: { videos: [], images: [] } }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

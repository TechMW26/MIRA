const JINA_SEARCH_URL = 'https://s.jina.ai/';
const JINA_READER_URL = 'https://r.jina.ai/';
const SEARCH_TIMEOUT_MS = 6_000;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const READER_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const SEARCH_CACHE = new Map();
const SEARCH_IN_FLIGHT = new Map();
const READER_CACHE = new Map();
let searchUnavailableUntil = 0;

function setBoundedCache(cache, key, value, limit = 100) {
  if (cache.size >= limit && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

function jinaKey() {
  return String(process.env.JINA_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function boundedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function cleanText(value = '', limit = 1800) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeItem(item = {}) {
  const url = String(item.url || item.link || item.source || '').trim();
  const title = cleanText(item.title || item.name || url || 'Web result', 240);
  const snippet = cleanText(
    item.description || item.snippet || item.content || item.text || item.markdown || title,
  );
  if (!title || !snippet) return null;
  return {
    title,
    snippet,
    url,
    ...(item.publishedTime || item.publishedAt || item.date
      ? { publishedAt: String(item.publishedTime || item.publishedAt || item.date) }
      : {}),
    provider: 'jina',
  };
}

export function parseJinaSearchPayload(payload = {}) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.results)
        ? payload.results
        : [];
  return candidates.map(normalizeItem).filter(Boolean);
}

export async function searchJina(query, { signal } = {}) {
  const key = jinaKey();
  if (!key) return null;
  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!normalizedQuery) return null;
  const now = Date.now();
  const cached = SEARCH_CACHE.get(normalizedQuery);
  if (cached?.expiresAt > now) return cached.results;
  if (now < searchUnavailableUntil) return null;
  if (SEARCH_IN_FLIGHT.has(normalizedQuery)) return SEARCH_IN_FLIGHT.get(normalizedQuery);

  const pending = (async () => {
    try {
      const response = await fetch(`${JINA_SEARCH_URL}?q=${encodeURIComponent(normalizedQuery)}`, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          'X-Return-Format': 'markdown',
          'X-Retain-Images': 'none',
          // Search needs SERP evidence, not five fully crawled pages. This keeps
          // the preferred provider in the 1-3 second range; /api/crawl handles
          // deep reading separately through r.jina.ai.
          'X-Respond-With': 'no-content',
        },
        signal: boundedSignal(signal, SEARCH_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok) {
        if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
          searchUnavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
        }
        return null;
      }
      const payload = await response.json().catch(() => null);
      const results = parseJinaSearchPayload(payload);
      if (!results.length) return null;
      searchUnavailableUntil = 0;
      setBoundedCache(SEARCH_CACHE, normalizedQuery, {
        results,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      });
      return results;
    } catch {
      searchUnavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
      return null;
    } finally {
      SEARCH_IN_FLIGHT.delete(normalizedQuery);
    }
  })();
  SEARCH_IN_FLIGHT.set(normalizedQuery, pending);
  return pending;
}

function accessStatus(status, content = '') {
  if ([401, 403].includes(status)) return 'blocked';
  if (status === 429) return 'rate-limited';
  const value = String(content || '').toLowerCase();
  if (/\b(sign in|log in|login required|create an account|members only|authentication required)\b/.test(value)) {
    return 'login-required';
  }
  if (/\b(access denied|forbidden|blocked by robots|captcha|not authorized|permission denied)\b/.test(value)) {
    return 'blocked';
  }
  return status >= 400 ? 'unavailable' : 'ok';
}

export async function readJinaUrl(url, { signal } = {}) {
  const key = jinaKey();
  if (!key) return null;
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return null;
  const cached = READER_CACHE.get(normalizedUrl);
  if (cached?.expiresAt > Date.now()) return cached.page;
  try {
    const response = await fetch(`${JINA_READER_URL}${normalizedUrl}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'X-Return-Format': 'markdown',
        'X-Retain-Images': 'none',
        'X-With-Links-Summary': 'true',
      },
      signal: boundedSignal(signal, 15_000),
      cache: 'no-store',
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { content: raw }; }
    const page = payload?.data || payload || {};
    const content = cleanText(page.content || page.markdown || page.text || '', 24_000);
    const result = {
      url: String(page.url || normalizedUrl),
      title: cleanText(page.title || '', 240),
      summary: cleanText(page.description || page.summary || content, 2_400),
      content,
      links: page.links && typeof page.links === 'object' ? page.links : [],
      status: response.status,
      accessStatus: accessStatus(response.status, content),
      provider: 'jina-reader',
    };
    setBoundedCache(READER_CACHE, normalizedUrl, {
      page: result,
      expiresAt: Date.now() + READER_CACHE_TTL_MS,
    });
    return result;
  } catch (error) {
    return {
      url: normalizedUrl,
      title: '',
      summary: '',
      content: '',
      links: [],
      status: 0,
      accessStatus: error?.name === 'AbortError' ? 'timed-out' : 'unavailable',
      provider: 'jina-reader',
    };
  }
}

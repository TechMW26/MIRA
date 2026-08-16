// ──────────────────────────────────────────────────────────────
// Response Cache — sessionStorage-backed LRU for chat responses
// ──────────────────────────────────────────────────────────────
// Caches assistant responses keyed by messages and system prompt
// so repeated identical queries (refresh, replay, etc.) skip the API call.
// Capped at MAX_ENTRIES with simple LRU eviction.

const CACHE_KEY = 'mira_response_cache_v2';
const MAX_ENTRIES = 40;
const TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — drop oldest half */
    const entries = Object.entries(cache).sort((a, b) => a[1].at - b[1].at);
    const trimmed = Object.fromEntries(entries.slice(Math.floor(entries.length / 2)));
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up */
    }
  }
}

// Fast non-crypto hash (FNV-1a-ish) for cache keys
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(36);
}

export function makeCacheKey({ messages = [], systemPrompt = '', images = [] }) {
  const containsLiveSearchData = messages.some((message) => (
    String(message?.content || '').includes('REAL-TIME WEB SEARCH DATA')
  ));
  const msgPart = messages
    .map((m) => `${m.role}:${(m.content || '').slice(0, 500)}`)
    .join('|');
  const hasImages = Array.isArray(images) && images.length > 0;
  // Skip caching when images are attached (binary content not hashable cheaply)
  if (hasImages || containsLiveSearchData) return null;
  return hash(`${systemPrompt.slice(0, 300)}::${msgPart}`);
}

export function getCachedResponse(key) {
  if (!key) return null;
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    delete cache[key];
    saveCache(cache);
    return null;
  }
  // Touch (LRU)
  entry.at = Date.now();
  saveCache(cache);
  return entry.response;
}

export function setCachedResponse(key, response) {
  if (!key || !response) return;
  const cache = loadCache();
  cache[key] = { response, at: Date.now() };

  // Evict oldest if over cap
  const entries = Object.entries(cache);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a[1].at - b[1].at);
    const keep = entries.slice(entries.length - MAX_ENTRIES);
    const next = Object.fromEntries(keep);
    saveCache(next);
    return;
  }
  saveCache(cache);
}

export function clearResponseCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}

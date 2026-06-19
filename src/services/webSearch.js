import { diagnosticError, diagnosticLog, diagnosticWarn } from './diagnostics.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const SEARCH_INTENT_PREFIX = /^(?:what|who|where|when|why|how|which|search|find|look\s+up|check|tell\s+me\s+about|give\s+me\s+(?:information|details)\s+(?:about|on))\s+/i;
const RELEVANCE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or', 'is', 'are',
  'was', 'were', 'what', 'who', 'where', 'when', 'why', 'how', 'which', 'most',
  'latest', 'current', 'currently', 'recent', 'newest', 'today', 'please', 'about',
  'expensive', 'cheap', 'cheapest', 'best', 'largest', 'smallest', 'biggest',
  'highest', 'lowest', 'top', 'popular', 'famous',
  'mujhe', 'mere', 'mera', 'meri', 'ke', 'ki', 'ka', 'baare', 'mein', 'me',
  'batao', 'bata', 'details', 'jaankari', 'jankari', 'kuch',
]);

const QUERY_NORMALIZATIONS = [
  [/\byatch\b/gi, 'yacht'],
  [/\byaht\b/gi, 'yacht'],
  [/\brn\b/gi, 'right now'],
  [/\bpls\b/gi, 'please'],
  [/\bu\.?s\.?a\b/gi, 'USA'],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSearchRetryQueries(query = '', freshness = false) {
  const raw = String(query || '').replace(/\s+/g, ' ').trim();
  const normalized = QUERY_NORMALIZATIONS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    raw,
  ).replace(/\s+/g, ' ').trim();
  const original = normalized || raw;
  if (!original) return [];

  const cleaned = original
    .replace(/[?!.]+$/g, '')
    .replace(SEARCH_INTENT_PREFIX, '')
    .replace(/^(?:mujhe|mere\s+ko)\s+/i, '')
    .replace(/\s+ke\s+baare\s+(?:me|mein)\b[\s\S]*$/i, '')
    .replace(/\s+(?:ke\s+)?(?:current\s+)?(?:verified\s+)?details?\s+batao\b[\s\S]*$/i, '')
    .replace(/\s+(?:kuch\s+)?batao\b[\s\S]*$/i, '')
    .replace(/^(?:is|are|was|were)\s+/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .trim();
  const withoutFillers = cleaned
    .replace(/\b(?:please|kindly|information|details|about)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const locationMatch = withoutFillers.match(/^(.{3,100}?)\s+in\s+([A-Za-z][A-Za-z .'-]{1,50})$/i);
  const locationFirst = locationMatch
    ? `${locationMatch[2].trim()} ${locationMatch[1].trim()}`
    : '';
  const quotedLocation = locationMatch
    ? `"${locationMatch[1].trim()}" ${locationMatch[2].trim()}`
    : '';
  const currentYear = new Date().getUTCFullYear();
  return Array.from(new Set([
    raw,
    original,
    cleaned,
    withoutFillers,
    quotedLocation,
    locationFirst,
    freshness && !new RegExp(`\\b${currentYear}\\b`).test(withoutFillers) ? `${withoutFillers} ${currentYear}` : '',
  ].filter((value) => value && value.length >= 3))).slice(0, freshness ? 5 : 4);
}

export function buildEvidenceFallbackAnswer(payload = {}, query = '') {
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .filter((result) => result?.title && result?.snippet)
    .slice(0, 4);
  if (!results.length) {
    return `I searched for “${String(query || '').trim()}”, but the available sources did not contain enough relevant evidence to answer reliably.`;
  }

  const details = results.map((result) => {
    const date = result.publishedAt ? ` (${result.publishedAt})` : '';
    return `- **${result.title}**${date}: ${String(result.snippet).replace(/\s+/g, ' ').trim()}`;
  });
  return `Here’s what the live search found about **${String(query || '').trim()}**:\n\n${details.join('\n')}`;
}

async function readSearchResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || payload?.message || `Search failed (${response.status})`;
    const error = new Error(String(message));
    error.status = response.status;
    throw error;
  }
  return payload || { results: [], media: { videos: [], images: [], articles: [] } };
}

function relevanceTokens(value = '') {
  return Array.from(new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !RELEVANCE_STOPWORDS.has(word))
  ));
}

export function isSearchResultRelevant(payload, query = '') {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return false;
  const tokens = relevanceTokens(query);
  if (!tokens.length) return true;
  const required = tokens.length >= 2 ? 2 : 1;
  return results.some((result) => {
    const text = `${result?.title || ''} ${result?.snippet || ''} ${result?.url || ''}`.toLowerCase();
    const score = tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
    return score >= required;
  });
}

function hasUsefulSearchData(payload, query) {
  const hasMedia = (Array.isArray(payload?.media?.videos) && payload.media.videos.length)
    || (Array.isArray(payload?.media?.images) && payload.media.images.length)
    || (Array.isArray(payload?.media?.articles) && payload.media.articles.length);
  return Boolean(hasMedia || isSearchResultRelevant(payload, query));
}

export async function searchWeb(payload = {}, options = {}) {
  const {
    attemptsPerQuery = 2,
    retryEmpty = true,
    signal,
  } = options;
  const freshness = Boolean(payload?.freshness);
  const queryVariants = retryEmpty
    ? buildSearchRetryQueries(payload?.query, freshness)
    : [String(payload?.query || '').trim()].filter(Boolean);

  let lastPayload = null;
  let lastError = null;
  let requestCount = 0;
  diagnosticLog('search', 'search started', {
    query: String(payload?.query || '').slice(0, 180),
    freshness,
    includeMedia: Boolean(payload?.includeMedia),
    variants: queryVariants.length,
  });

  for (const query of queryVariants) {
    for (let attempt = 1; attempt <= attemptsPerQuery; attempt += 1) {
      requestCount += 1;
      const startedAt = Date.now();
      try {
        diagnosticLog('search', 'search attempt', {
          query: String(query).slice(0, 180),
          attempt,
          requestCount,
        });
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, query }),
          signal,
        });
        const data = await readSearchResponse(response);
        lastPayload = data;
        if (hasUsefulSearchData(data, query)) {
          diagnosticLog('search', 'search completed', {
            queryUsed: String(query).slice(0, 180),
            attempts: requestCount,
            source: data?.source || 'unknown',
            resultCount: Array.isArray(data?.results) ? data.results.length : 0,
            videoCount: Array.isArray(data?.media?.videos) ? data.media.videos.length : 0,
            imageCount: Array.isArray(data?.media?.images) ? data.media.images.length : 0,
            elapsedMs: Date.now() - startedAt,
          });
          return {
            ...data,
            searchMeta: {
              ...(data.searchMeta || {}),
              originalQuery: payload.query,
              queryUsed: query,
              attempts: requestCount,
              recovered: requestCount > 1 || query !== payload.query,
            },
          };
        }
        diagnosticWarn('search', 'search returned no useful results', {
          query: String(query).slice(0, 180),
          attempt,
          requestCount,
        });
        break;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        const retryable = !error?.status || RETRYABLE_STATUS.has(error.status);
        diagnosticWarn('search', retryable ? 'search attempt failed; retrying' : 'search attempt failed', {
          query: String(query).slice(0, 180),
          attempt,
          requestCount,
          status: error?.status || 'network',
          error: error?.message || 'Unknown search error',
        });
        if (!retryable || attempt >= attemptsPerQuery) break;
        await sleep(250 * (2 ** (attempt - 1)));
      }
    }
  }

  if (lastPayload) {
    diagnosticWarn('search', 'search exhausted without useful results', {
      originalQuery: String(payload?.query || '').slice(0, 180),
      attempts: requestCount,
    });
    return {
      ...lastPayload,
      searchMeta: {
        ...(lastPayload.searchMeta || {}),
        originalQuery: payload.query,
        queryUsed: queryVariants.at(-1) || payload.query,
        attempts: requestCount,
        recovered: false,
        exhausted: true,
      },
    };
  }

  diagnosticError('search', 'search exhausted with error', {
    originalQuery: String(payload?.query || '').slice(0, 180),
    attempts: requestCount,
    error: lastError?.message || 'Web search failed after retries.',
  });
  throw lastError || new Error('Web search failed after retries.');
}

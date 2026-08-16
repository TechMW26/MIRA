import { diagnosticError, diagnosticLog, diagnosticWarn } from './diagnostics.js';
import {
  buildSearchQueryVariants,
  extractSearchSubject,
  rankSearchResults,
} from './searchRelevance.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

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

export function cleanSearchEvidenceText(value = '', limit = 1400) {
  const cleaned = String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, limit).trim();
}

function cleanSearchResult(result = {}) {
  return {
    ...result,
    title: cleanSearchEvidenceText(result.title, 240),
    snippet: cleanSearchEvidenceText(result.snippet || result.title, 1400),
  };
}

export function buildSearchRetryQueries(query = '', freshness = false) {
  const raw = String(query || '').replace(/\s+/g, ' ').trim();
  const normalized = QUERY_NORMALIZATIONS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    raw,
  ).replace(/\s+/g, ' ').trim();
  const original = normalized || raw;
  if (!original) return [];
  const cleaned = extractSearchSubject(original)
    .replace(/^(?:mujhe|mere\s+ko)\s+/i, '')
    .replace(/\s+ke\s+baare\s+(?:me|mein)\b[\s\S]*$/i, '')
    .replace(/\s+(?:ke\s+)?(?:current\s+)?(?:verified\s+)?details?\s+batao\b[\s\S]*$/i, '')
    .replace(/\s+(?:kuch\s+)?batao\b[\s\S]*$/i, '')
    .trim();
  const withoutFillers = cleaned.replace(/\b(?:please|kindly|information|details|about)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const locationMatch = withoutFillers.match(/^(.{3,100}?)\s+in\s+([A-Za-z][A-Za-z .'-]{1,50})$/i);
  const locationFirst = locationMatch
    ? `${locationMatch[2].trim()} ${locationMatch[1].trim()}`
    : '';
  const quotedLocation = locationMatch
    ? `"${locationMatch[1].trim()}" ${locationMatch[2].trim()}`
    : '';
  return Array.from(new Set([
    ...buildSearchQueryVariants(withoutFillers || original, freshness),
    quotedLocation,
    locationFirst,
    raw,
  ].filter((value) => value && value.length >= 2))).slice(0, freshness ? 7 : 6);
}

export function buildEvidenceFallbackAnswer(payload = {}, query = '') {
  const results = rankSearchResults(
    (Array.isArray(payload?.results) ? payload.results : []).map(cleanSearchResult),
    query,
    4,
  )
    .filter((result) => result?.title && result?.snippet)
    .slice(0, 4);
  if (!results.length) {
    return `I searched for “${String(query || '').trim()}”, but the available sources did not contain enough relevant evidence to answer reliably.`;
  }

  const facts = [];
  for (const result of results) {
    const sentences = cleanSearchEvidenceText(result.snippet, 520).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    for (const sentence of sentences.slice(0, 2)) {
      const fact = sentence.replace(/\s+/g, ' ').trim();
      if (fact.length < 24) continue;
      const normalized = fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      if (facts.some((existing) => existing.normalized.includes(normalized) || normalized.includes(existing.normalized))) continue;
      facts.push({ text: fact, normalized });
      if (facts.length >= 3) break;
    }
    if (facts.length >= 3) break;
  }

  const details = results.map((result) => {
    const published = result.publishedAt ? new Date(result.publishedAt) : null;
    const date = published && !Number.isNaN(published.getTime())
      ? ` (${published.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })})`
      : '';
    const safeUrl = /^https?:\/\//i.test(result.url || '') && String(result.url).length <= 320
      ? result.url
      : '';
    const titleText = cleanSearchEvidenceText(result.title, 180) || 'Source';
    const title = safeUrl ? `[${titleText}](${safeUrl})` : titleText;
    return `- ${title}${date}`;
  });
  const summary = facts.map((fact) => fact.text).join(' ')
    || 'The retrieved sources did not contain enough clean detail for a reliable summary.';
  return `${summary}\n\n### Sources\n\n${details.join('\n')}`;
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

export function isSearchResultRelevant(payload, query = '') {
  return rankSearchResults(payload?.results, query, 1).length > 0;
}

function hasUsefulSearchData(payload, query, includeMedia = false, requireTextResults = false) {
  const hasMedia = includeMedia && ((Array.isArray(payload?.media?.videos) && payload.media.videos.length)
    || (Array.isArray(payload?.media?.images) && payload.media.images.length)
    || (Array.isArray(payload?.media?.articles) && payload.media.articles.length));
  const hasRelevantText = isSearchResultRelevant(payload, query);
  return requireTextResults ? hasRelevantText : Boolean(hasMedia || hasRelevantText);
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
  const relevanceQuery = extractSearchSubject(payload?.anchor || payload?.query || '');
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
          body: JSON.stringify({ ...payload, query, relevanceQuery }),
          signal,
        });
        const data = await readSearchResponse(response);
        const rankedData = {
          ...data,
          results: rankSearchResults(
            (Array.isArray(data?.results) ? data.results : []).map(cleanSearchResult),
            relevanceQuery || payload.query,
            8,
          ),
        };
        lastPayload = rankedData;
        if (hasUsefulSearchData(
          rankedData,
          relevanceQuery || payload.query,
          Boolean(payload?.includeMedia),
          Boolean(payload?.requireTextResults),
        )) {
          diagnosticLog('search', 'search completed', {
            queryUsed: String(query).slice(0, 180),
            attempts: requestCount,
            source: rankedData?.source || 'unknown',
            resultCount: rankedData.results.length,
            videoCount: Array.isArray(rankedData?.media?.videos) ? rankedData.media.videos.length : 0,
            imageCount: Array.isArray(rankedData?.media?.images) ? rankedData.media.images.length : 0,
            elapsedMs: Date.now() - startedAt,
          });
          return {
            ...rankedData,
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

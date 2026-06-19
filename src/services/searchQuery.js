import { diagnosticLog, diagnosticWarn } from './diagnostics.js';
import { buildSearchRetryQueries } from './webSearch.js';

function fallbackQuery(latestMessage = '') {
  const variants = buildSearchRetryQueries(latestMessage, false);
  return variants[1] || variants[0] || String(latestMessage || '').trim();
}

export async function formSearchQuery({ latestMessage = '', context = '', signal } = {}) {
  const latest = String(latestMessage || '').trim();
  if (!latest) return '';

  try {
    const response = await fetch('/api/search-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latestMessage: latest, context }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.query) {
      throw new Error(payload?.error || `Query formation failed (${response.status})`);
    }
    diagnosticLog('search', 'AI search query formed from latest message', {
      latestMessage: latest.slice(0, 180),
      query: String(payload.query).slice(0, 180),
      source: payload.source || 'unknown',
    });
    return String(payload.query).trim();
  } catch (error) {
    const query = fallbackQuery(latest);
    diagnosticWarn('search', 'AI query formation unavailable; using latest-message fallback', {
      latestMessage: latest.slice(0, 180),
      query: query.slice(0, 180),
      error: error?.message || String(error),
    });
    return query;
  }
}

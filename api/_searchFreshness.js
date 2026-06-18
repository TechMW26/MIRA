const FRESHNESS_RE = /\b(latest|most recent|newest|current|currently|today|tonight|right now|just announced|breaking|recent|recently|this week|this month|this year|live|real[- ]?time|up[- ]?to[- ]?date|202[5-9]|203\d)\b/i;

export function detectFreshnessIntent(query = '', explicit = false) {
  return Boolean(explicit) || FRESHNESS_RE.test(String(query || ''));
}

export function freshnessWindow(query = '') {
  const value = String(query || '');
  if (/\b(today|tonight|right now|breaking|live|real[- ]?time)\b/i.test(value)) return { brave: 'pd', google: 'd2', maxAgeDays: 2 };
  if (/\b(this week|latest|most recent|newest|just announced)\b/i.test(value)) return { brave: 'pw', google: 'd7', maxAgeDays: 7 };
  if (/\b(this month|recent|recently|current|currently|up[- ]?to[- ]?date)\b/i.test(value)) return { brave: 'pm', google: 'd31', maxAgeDays: 31 };
  return { brave: 'py', google: 'd365', maxAgeDays: 365 };
}

export function normalizePublishedAt(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function extractGooglePublishedAt(item = {}) {
  const meta = item?.pagemap?.metatags?.[0] || {};
  const candidates = [
    meta['article:published_time'],
    meta['article:modified_time'],
    meta['date'],
    meta['datepublished'],
    meta['datecreated'],
    meta['last-modified'],
    item?.snippet?.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+20\d{2}\b/i)?.[0],
  ];
  for (const candidate of candidates) {
    const normalized = normalizePublishedAt(candidate);
    if (normalized) return normalized;
  }
  return '';
}

export function rankFreshResults(items = [], { maxAgeDays = 31, now = Date.now() } = {}) {
  const unique = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.url || item?.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const publishedAt = normalizePublishedAt(item?.publishedAt || item?.published || item?.date || '');
    unique.push({ ...item, ...(publishedAt ? { publishedAt } : {}) });
  }

  const dated = unique
    .filter((item) => item.publishedAt)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (!dated.length) return unique.slice(0, 6);

  const newestTimestamp = Date.parse(dated[0].publishedAt);
  const requestedCutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const cohortCutoff = newestTimestamp - Math.min(maxAgeDays, 14) * 24 * 60 * 60 * 1000;
  const cutoff = Math.max(requestedCutoff, cohortCutoff);
  const freshest = dated.filter((item) => Date.parse(item.publishedAt) >= cutoff);
  return (freshest.length ? freshest : dated.slice(0, 3)).slice(0, 6);
}


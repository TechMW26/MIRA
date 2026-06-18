const WEB_SEARCH_MARKER_RE = /\[WEB_SEARCH\s*:\s*([^\]\r\n]{2,240})\]/i;
const XML_WEB_SEARCH_RE = /<web_search>\s*([^<\r\n]{2,240})\s*<\/web_search>/i;
const PARTIAL_WEB_SEARCH_RE = /(?:\[WEB_SEARCH(?:\s*:)?|<web_search>)\s*[^\]\n<]*$/i;

function cleanSearchQuery(value = '') {
  return String(value || '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function extractWebSearchRequest(...values) {
  for (const value of values) {
    const text = String(value || '');
    const markerMatch = text.match(WEB_SEARCH_MARKER_RE);
    const match = markerMatch || text.match(XML_WEB_SEARCH_RE);
    const query = cleanSearchQuery(match?.[1] || '');
    if (query) return { query, source: markerMatch ? 'marker' : 'control' };
  }
  return null;
}

export function stripWebSearchControl(value = '') {
  return String(value || '')
    .replace(WEB_SEARCH_MARKER_RE, '')
    .replace(XML_WEB_SEARCH_RE, '')
    .replace(PARTIAL_WEB_SEARCH_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isPotentialWebSearchControl(value = '') {
  const text = String(value || '').trim();
  return WEB_SEARCH_MARKER_RE.test(text)
    || XML_WEB_SEARCH_RE.test(text)
    || PARTIAL_WEB_SEARCH_RE.test(text);
}

export function thinkingSuggestsWebSearch(value = '') {
  const text = String(value || '');
  if (text.length < 10) return false;
  return /\b(?:(?:need|should|must)\s+(?:to\s+)?|(?:have|best)\s+to\s+)(?:search|browse|look up|verify|check)\b/i.test(text)
    || /\b(?:current|latest|live|real[- ]?time|up[- ]?to[- ]?date)\s+(?:information|data|details|sources?|results?)\b/i.test(text)
    || /\b(?:not|isn'?t|aren'?t)\s+(?:in|covered by)\s+(?:my\s+)?(?:knowledge|training data)\b/i.test(text);
}

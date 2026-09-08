const WEB_SEARCH_MARKER_RE = /\[(?:MIRA_WEB_SEARCH|WEB_SEARCH)\s*:\s*([^\]\r\n]{2,240})\]/i;
// Some OpenAI-compatible providers serialize the same control name with a
// dot or dash instead of an underscore. Treat those spellings as controls,
// never as assistant-visible prose.
const XML_WEB_SEARCH_RE = /<web[._-]search>\s*([^<\r\n]{2,240})\s*<\/web[._-]search>/i;
const PARTIAL_WEB_SEARCH_RE = /(?:\[(?:MIRA_WEB_SEARCH|WEB_SEARCH)(?:\s*:)?|<web[._-]search>)\s*[^\]\n<]*$/i;

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

const QUERY_PREFIX = /^(?:what\s+do\s+you\s+know\s+about|do\s+you\s+know\s+about|what\s+can\s+you\s+tell\s+me\s+about|tell\s+me\s+(?:something\s+|more\s+)?about|give\s+me\s+(?:information|details)\s+(?:about|on)|search(?:\s+the\s+web)?\s+for|look\s+up|find\s+out\s+about|what\s+is|what\s+are|who\s+is|who\s+are)\s+/i;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or', 'is', 'are',
  'was', 'were', 'what', 'who', 'where', 'when', 'why', 'how', 'which', 'do', 'does',
  'did', 'know', 'tell', 'give', 'show', 'search', 'find', 'look', 'information', 'info',
  'details', 'please', 'kindly', 'about', 'most', 'latest', 'current', 'currently',
  'recent', 'newest', 'today', 'expensive', 'cheap', 'cheapest', 'best', 'largest',
  'smallest', 'biggest', 'highest', 'lowest', 'top', 'popular', 'famous', 'mujhe',
  'mere', 'mera', 'meri', 'ke', 'ki', 'ka', 'baare', 'mein', 'me', 'batao', 'bata',
  'jaankari', 'jankari', 'kuch',
]);
const COMPOUND_SUFFIXES = ['tree', 'tech', 'labs', 'lab', 'bio', 'cloud', 'works', 'world', 'hub', 'ai'];

export function normalizeSearchValue(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchResultIdentity(result = {}) {
  const rawUrl = String(result.url || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = '';
      for (const key of Array.from(url.searchParams.keys())) {
        if (/^(?:utm_.+|gclid|fbclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
      }
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return `url:${host}${path}${url.search}`;
    } catch {
      // Fall back to the title for malformed provider URLs.
    }
  }
  const title = normalizeSearchValue(result.title || '');
  return title ? `title:${title}` : '';
}

export function expandCompoundWords(value = '') {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      const suffix = COMPOUND_SUFFIXES.find((candidate) => (
        lower.endsWith(candidate) && lower.length >= candidate.length + 4
      ));
      return suffix ? `${word.slice(0, -suffix.length)} ${word.slice(-suffix.length)}` : word;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSearchSubject(query = '') {
  let value = String(query || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  value = value
    .replace(/[?!.]+$/g, '')
    .replace(QUERY_PREFIX, '')
    .replace(/^(?:please|kindly)\s+/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:please|kindly)$/i, '')
    .trim();
  return value || String(query || '').trim();
}

function relevanceProfile(query = '') {
  const subject = extractSearchSubject(query);
  const expanded = expandCompoundWords(subject);
  const phrase = normalizeSearchValue(expanded);
  const compact = phrase.replace(/\s+/g, '');
  const tokens = Array.from(new Set(
    phrase.split(' ').filter((token) => token.length >= 2 && !STOPWORDS.has(token)),
  ));
  return { subject, expanded, phrase, compact, tokens };
}

export function buildSearchQueryVariants(query = '', freshness = false) {
  const raw = String(query || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const subject = extractSearchSubject(raw);
  const expanded = expandCompoundWords(subject);
  const words = expanded.split(/\s+/).filter(Boolean);
  const entityLike = words.length <= 4 && (
    /[a-z][A-Z]/.test(subject)
    || (!subject.includes(' ') && subject.length >= 7)
    || expanded !== subject
  );
  const currentYear = new Date().getUTCFullYear();
  return Array.from(new Set([
    subject,
    expanded !== subject ? expanded : '',
    entityLike ? `"${subject}"` : '',
    entityLike && expanded !== subject ? `"${expanded}"` : '',
    raw,
    freshness && !new RegExp(`\\b${currentYear}\\b`).test(expanded) ? `${expanded} ${currentYear}` : '',
  ].filter((value) => value && value.length >= 2))).slice(0, freshness ? 6 : 5);
}

export function scoreSearchResult(result = {}, query = '') {
  const profile = relevanceProfile(query);
  if (!profile.tokens.length && !profile.compact) return { relevant: true, score: 1, coverage: 1 };

  const title = normalizeSearchValue(result.title || '');
  const body = normalizeSearchValue(`${result.title || ''} ${result.snippet || ''} ${result.url || ''}`);
  const bodyCompact = body.replace(/\s+/g, '');
  const exactPhrase = profile.phrase.length >= 4 && body.includes(profile.phrase);
  const compactPhrase = profile.compact.length >= 6 && bodyCompact.includes(profile.compact);
  const matched = profile.tokens.filter((token) => body.includes(token));
  const titleMatches = profile.tokens.filter((token) => title.includes(token)).length;
  const coverage = profile.tokens.length ? matched.length / profile.tokens.length : 1;
  const score = (exactPhrase ? 8 : 0)
    + (compactPhrase ? 7 : 0)
    + matched.reduce((total, token) => total + Math.min(2.5, 1 + token.length / 8), 0)
    + titleMatches * 1.5;
  const relevant = exactPhrase
    || compactPhrase
    || (profile.tokens.length === 1 ? coverage === 1 && score >= 2 : coverage >= 0.6 && score >= 4);
  return { relevant, score: Number(score.toFixed(2)), coverage: Number(coverage.toFixed(2)) };
}

export function rankSearchResults(results = [], query = '', limit = 8) {
  const seen = new Set();
  return (Array.isArray(results) ? results : [])
    .map((result, index) => ({ result, index, relevance: scoreSearchResult(result, query) }))
    .filter(({ relevance }) => relevance.relevant)
    .sort((a, b) => b.relevance.score - a.relevance.score || a.index - b.index)
    .filter(({ result }) => {
      const key = searchResultIdentity(result);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ result, relevance }) => ({ ...result, relevanceScore: relevance.score }));
}

export function fuseSearchProviders(providerGroups = [], query = '', limit = 10) {
  const candidates = [];
  for (const group of providerGroups) {
    const weight = Number(group?.weight || 1);
    for (const [index, result] of (group?.results || []).entries()) {
      const relevance = scoreSearchResult(result, query);
      if (!relevance.relevant) continue;
      candidates.push({
        ...result,
        provider: group.provider,
        relevanceScore: relevance.score,
        fusionScore: relevance.score + weight + (2 / (index + 1)),
      });
    }
  }
  return candidates
    .sort((a, b) => b.fusionScore - a.fusionScore)
    .filter((result, index, all) => {
      const key = searchResultIdentity(result);
      return key && all.findIndex((candidate) => searchResultIdentity(candidate) === key) === index;
    })
    .slice(0, limit);
}

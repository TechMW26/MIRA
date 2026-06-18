import { isSearchResultRelevant } from './webSearch.js';

const IDENTITY_QUESTION_RE = /\b(who are you|what are you|your name|who (?:made|built|created|powers) you|what model)\b/i;
const UNJUSTIFIED_REFUSAL_RE = /\b(?:i (?:cannot|can't|am unable to|do not have|don't have)|unable to answer|cannot answer|can't answer)\b/i;
const SEARCH_META_RE = /\b(?:the |these )?(?:provided )?search results?\s+(?:do not|don't|did not|didn't|only|contain|focus|discuss|provided)\b/i;
const ACCESS_DENIAL_RE = /\b(?:no access to|cannot access|can't access|cannot browse|can't browse|knowledge cut[- ]?off|training data)\b/i;

function meaningfulTokens(value = '') {
  const stop = new Set([
    'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or', 'is',
    'are', 'was', 'were', 'what', 'who', 'where', 'when', 'why', 'how', 'which',
    'most', 'latest', 'current', 'today', 'right', 'now', 'please', 'about',
  ]);
  return Array.from(new Set(
    String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((word) => word.length >= 3 && !stop.has(word))
  ));
}

export function assessResponseQuality({
  answer = '',
  userQuery = '',
  searchData = null,
  searchQuery = '',
} = {}) {
  const text = String(answer || '').trim();
  const reasons = [];
  const grounded = Array.isArray(searchData?.results) && searchData.results.length > 0;
  const evidenceRelevant = grounded && isSearchResultRelevant(searchData, searchQuery || userQuery);

  if (text.length < 12) reasons.push('answer-too-short');
  if (!IDENTITY_QUESTION_RE.test(userQuery) && /^\s*i am mira\b/i.test(text)) {
    reasons.push('irrelevant-identity-introduction');
  }
  if (ACCESS_DENIAL_RE.test(text)) reasons.push('false-capability-denial');
  if (grounded && evidenceRelevant && UNJUSTIFIED_REFUSAL_RE.test(text)) {
    reasons.push('unjustified-grounded-refusal');
  }
  if (grounded && evidenceRelevant && SEARCH_META_RE.test(text)) {
    reasons.push('search-process-meta-answer');
  }
  if (grounded && evidenceRelevant && !/\[\d+\]/.test(text)) {
    reasons.push('missing-grounded-citation');
  }

  const queryTokens = meaningfulTokens(userQuery);
  if (text.length >= 40 && queryTokens.length) {
    const lower = text.toLowerCase();
    const overlap = queryTokens.filter((token) => lower.includes(token)).length;
    if (overlap === 0) reasons.push('answer-off-topic');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    grounded,
    evidenceRelevant,
  };
}

export function buildQualityCorrectionPrompt({
  userQuery = '',
  reasons = [],
  freshnessRequested = false,
} = {}) {
  return [
    'QUALITY CORRECTION: The previous draft was rejected by the host.',
    `Original user question: "${String(userQuery || '').trim()}"`,
    `Problems detected: ${reasons.join(', ') || 'failed to answer directly'}.`,
    'Produce a fresh final answer, not a critique of the previous draft.',
    'Answer the question immediately in the first sentence.',
    'Use the supplied REAL-TIME WEB SEARCH DATA when present and cite factual claims as [1], [2].',
    'Do not discuss your knowledge, training, browsing ability, search process, missing data, or identity unless the user explicitly asks.',
    'Do not summarize irrelevant search results. Ignore irrelevant evidence.',
    freshnessRequested
      ? 'The user asked for current information: use the newest relevant dated evidence and state the exact evidence date.'
      : '',
    'If evidence genuinely conflicts, state the best-supported conclusion and the uncertainty briefly.',
  ].filter(Boolean).join('\n');
}


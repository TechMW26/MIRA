import { isSearchResultRelevant } from './webSearch.js';
import { isAssistantIdentityQuestion } from './contextPolicy.js';

const IDENTITY_QUESTION_RE = /\b(who (?:made|built|created|powers) you|what model)\b/i;
const UNJUSTIFIED_REFUSAL_RE = /\b(?:i (?:cannot|can['’]?t|couldn['’]?t|am unable to|do not have|don['’]?t have)|unable to answer|cannot answer|can['’]?t answer|couldn['’]?t answer)\b/i;
const SEARCH_META_RE = /\b(?:(?:the |these )?(?:provided )?search results?\s+(?:do not|don['’]?t|did not|didn['’]?t|only|contain|focus|discuss|provided)|(?:i\s+)?couldn['’]?t find (?:any )?(?:relevant )?(?:information|details|evidence)[^.!?]{0,80}(?:provided )?search results?)\b/i;
const ACCESS_DENIAL_RE = /\b(?:no access to|cannot access|can't access|cannot browse|can't browse|knowledge cut[- ]?off|training data)\b/i;

function normalizeRepetitionBlock(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#\[\](){}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function removeResponseRepetition(answer = '') {
  const blocks = String(answer || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const kept = [];
  const seen = new Set();
  let removedDuplicate = false;

  blocks.forEach((block) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    // Generated code and quoted source material may intentionally repeat.
    if (trimmed.includes('```')) {
      kept.push(trimmed);
      return;
    }

    const normalized = normalizeRepetitionBlock(trimmed);
    if (normalized.length >= 40 && seen.has(normalized)) {
      removedDuplicate = true;
      return;
    }

    kept.push(trimmed);
    if (normalized.length >= 40) seen.add(normalized);
  });

  // Models often stop halfway through one final copy of a repeated block.
  if (removedDuplicate && kept.length > 1) {
    const finalBlock = normalizeRepetitionBlock(kept.at(-1));
    const isRepeatedFragment = finalBlock.length >= 12
      && Array.from(seen).some((block) => block !== finalBlock && block.startsWith(finalBlock));
    if (isRepeatedFragment) kept.pop();
  }

  return kept.join('\n\n').trim();
}

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
  const identityRequested = isAssistantIdentityQuestion(userQuery) || IDENTITY_QUESTION_RE.test(userQuery);

  if (text.length < 12) reasons.push('answer-too-short');
  if (!identityRequested && /^\s*i(?:'m| am) mira\b/i.test(text)) {
    reasons.push('irrelevant-identity-introduction');
  }
  if (ACCESS_DENIAL_RE.test(text)) reasons.push('false-capability-denial');
  if (grounded && evidenceRelevant && UNJUSTIFIED_REFUSAL_RE.test(text)) {
    reasons.push('unjustified-grounded-refusal');
  }
  if (grounded && evidenceRelevant && SEARCH_META_RE.test(text)) {
    reasons.push('search-process-meta-answer');
  }
  const queryTokens = meaningfulTokens(userQuery);
  if (!identityRequested && text.length >= 40 && queryTokens.length) {
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
    'Write like a thoughtful human: natural wording, varied sentence length, plain language, and no canned AI filler or repetitive conclusion.',
    'Never use an em dash. Rewrite with normal punctuation or a new sentence.',
    'Use the supplied REAL-TIME WEB SEARCH DATA when present, but do not print numeric citation markers such as [1] or [1, 2]. Source provenance is rendered separately by the host.',
    'Read the source titles and snippets literally. If they name the same entity as the user query, the evidence is relevant; synthesize it instead of claiming nothing was found.',
    'Extract at least two concrete facts from relevant evidence before concluding.',
    'Do not discuss your knowledge, training, browsing ability, search process, missing data, or identity unless the user explicitly asks.',
    'Do not summarize irrelevant search results. Ignore irrelevant evidence.',
    freshnessRequested
      ? 'The user asked for current information: use the newest relevant dated evidence and state the exact evidence date.'
      : '',
    'If evidence genuinely conflicts, state the best-supported conclusion and the uncertainty briefly.',
  ].filter(Boolean).join('\n');
}

export function humanizeAssistantText(answer = '') {
  const lines = String(answer || '').replace(/\r\n?/g, '\n').split('\n');
  let insideFence = false;

  const humanized = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence) return line;
    return line
      .replace(/\s*—\s*/g, ', ')
      .replace(/\b(?:It is important to note that|It should be noted that)\s+([a-z])/gi, (_match, letter) => letter.toUpperCase())
      .replace(/\bIn conclusion,\s*([a-z])/gi, (_match, letter) => letter.toUpperCase())
      .replace(/\bAdditionally,\s*/gi, 'Also, ')
      .replace(/\bFurthermore,\s*/gi, 'Also, ');
  }).join('\n');

  return removeResponseRepetition(humanized);
}

export function polishAssistantAnswer(answer = '', { grounded = false } = {}) {
  let text = humanizeAssistantText(answer).trim();
  if (!text) return '';

  text = text
    .replace(/^\s*(?:(?:sure|certainly|of course|absolutely|great question)\b[!,.]*\s*)+(?=\S)/i, '')
    .replace(/\n{2,}(?:Let me know if you(?:'d| would) like|Feel free to ask if you(?:'d| would) like|I can also help (?:you )?with)[^\n]*[.!]?\s*$/i, '')
    .trim();

  if (grounded) {
    text = text
      .replace(/^\s*(?:#{1,6}[ \t]*)?summary\b[ \t]*:?[ \t]*(?:\n+[ \t]*|(?=\S))/i, '')
      .replace(/(^|\n)[ \t]*#{1,6}[ \t]+(Sources|References)[ \t]*[-:][ \t]*/gi, '$1### $2\n\n- ')
      .replace(/\s*\[(?:\d+(?:\s*,\s*\d+)*)\]/g, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\bHere (?:are|is) (?:some |a few )?(?:key |important )?(?:facts|details|points)(?::)?[ \t]*/gi, '')
      .replace(/\butili[sz]es\b/gi, 'uses')
      .replace(/\bbio-engineering\b/gi, 'bioengineered');
  }

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim();
}

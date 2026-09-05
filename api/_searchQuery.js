import { extractSearchSubject } from '../src/services/searchRelevance.js';

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^```(?:text)?|```$/gi, '')
    .replace(/^(?:query|search query)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function contextAnchor(context = '') {
  const value = String(context || '');
  const explicit = value.match(/(?:Recent subject anchor|Image-derived searchable entity|Model search hint):\s*([^\n]{2,120})/i)?.[1]?.trim();
  if (explicit) return extractSearchSubject(explicit);
  const quoted = value.match(/["“]([^"”]{3,100})["”]/)?.[1]?.trim();
  if (quoted) return extractSearchSubject(quoted);
  const named = value.match(/\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+|(?:\s+[A-Z][A-Za-z0-9]+){1,4})\b/)?.[0]?.trim();
  return named ? extractSearchSubject(named) : '';
}

export function fallbackSearchQuery(latestMessage = '', context = '') {
  const exact = cleanQuery(latestMessage)
    .replace(/^(?:okay|ok|alright|right)[,!\.\s]+/i, '')
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, '')
    .replace(/^(?:please\s+)?(?:tell\s+me|let\s+me\s+know|explain)\s+(?:about\s+)?/i, '')
    .replace(/^(?:please\s+)?(?:perform|prepare|give|provide)\s+(?:me\s+)?/i, '')
    .trim();
  const subject = extractSearchSubject(exact
    .replace(/^(?:hi|hello|hey|please|kindly|can you|could you|would you)[,!\.\s]+/i, ''));
  const referential = /\b(it|its|this|that|these|those|they|them|their|theirs|his|her|hers|same|former|latter)\b/i.test(subject);
  const anchor = referential ? contextAnchor(context) : '';
  const asksPurpose = /\bwhat\s+(?:does|do|did)\b[\s\S]*\bdo\b/i.test(subject);
  const withoutReferences = subject
    .replace(/\b(it|its|this|that|these|those|they|them|their|theirs|his|her|hers|same|former|latter)\b/gi, ' ')
    .replace(/\b(?:on|about|for)\s+(?=market\b)/gi, ' ')
    .replace(/^what\s+(.+?)\s+(?:is|are|was|were)\s*\??$/i, '$1')
    .replace(/^(?:what|who|where|when|why|how)\s+/i, '')
    .replace(/^(?:does|do|did|is|are|was|were|can)\s+/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\bdo\s*$/i, '')
    .replace(/\b(?:some|extensive)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (anchor && asksPurpose) return `${anchor} purpose function`;
  return [anchor, withoutReferences].filter(Boolean).join(' ').trim() || subject || exact;
}

export async function formSearchQuery({ latestMessage = '', context = '' } = {}) {
  const latest = String(latestMessage || '').trim();
  if (!latest) return { query: '', source: 'empty' };
  return { query: fallbackSearchQuery(latest, context), source: 'deterministic' };
}

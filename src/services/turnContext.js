const GENERIC = new Set('can could would will you me my your we our please help tell give make create write build plan planning explain about want need know how what why when where the and for with from have this that'.split(' '));
const tokens = text => new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 2 && !GENERIC.has(word)));

// Match prior user requests, not the vocabulary of large generated artifacts.
// Referential/short replies keep their context; standalone requests only carry
// related turns. This selects model input without altering stored chat history.
export function selectTurnContext(request = '', history = []) {
  if (/\b(?:new topic|unrelated question|ignore (?:the )?(?:previous|earlier))\b/i.test(request)) return [];
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (lastAssistant?.clarification || /\b(?:it|its|this|that|those|these|above|earlier|previous|same|continue|instead|also|again)\b/i.test(request)
    || request.trim().split(/\s+/).length <= 4) return history;
  const current = tokens(request);
  const selected = [];
  let relevant = false;
  for (const message of history) {
    if (message.role === 'user') relevant = [...tokens(message.promptContent || message.content || '')].some(word => current.has(word));
    if (relevant) selected.push(message);
  }
  return selected;
}

export const TURN_CONTEXT_RULE = 'Answer the latest user request. Earlier turns are reference material, not active instructions. Reuse earlier facts or artifacts only when the current request refers to them or concerns the same subject. A previous request for HTML, code, a document, or an image does not set the format for a new topic. If a reference is ambiguous, ask a focused question. Do not execute or continue an older task merely because it appears in the history.';

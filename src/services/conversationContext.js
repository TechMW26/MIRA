const CONTEXT_ENTITY_STOP = new Set([
  'i', 'the', 'a', 'an', 'it', 'this', 'that', 'these', 'those', 'you', 'he', 'she',
  'we', 'they', 'my', 'your', 'mira', 'ai', 'pdf', 'docx', 'pptx',
  // Sentence-opening discourse words are not conversation subjects. Treating
  // "Right" or "Okay" as an entity previously produced searches for dictionary
  // definitions instead of the product discussed in the preceding turns.
  'right', 'okay', 'ok', 'got', 'sure', 'yes', 'no', 'please', 'hello', 'hi',
  'thanks', 'thank', 'also', 'now', 'so', 'could', 'can', 'would', 'will',
]);

export function extractContextEntities(text = '') {
  const matches = String(text || '')
    .slice(0, 2600)
    .match(/"([^"]{2,60})"|“([^”]{2,60})”|\b([A-Z][A-Za-z0-9]+(?:[-\s]+[A-Z][A-Za-z0-9]+){0,4})\b|\b([A-Z0-9]{2,}(?:[-\s]+[A-Z0-9]{2,}){0,3})\b/g) || [];

  return Array.from(new Set(
    matches
      .map((value) => value.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim())
      .filter((value) => value.length > 2 && !CONTEXT_ENTITY_STOP.has(value.toLowerCase()))
  ));
}

export function getRecentContextEntities(historySource = [], limit = 5) {
  const recent = Array.isArray(historySource) ? historySource.slice(-8) : [];
  const entities = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index] || {};
    const text = String(message.promptContent || message.content || '');
    entities.push(...extractContextEntities(text));
    if (message?.media?.query) entities.push(...extractContextEntities(message.media.query));
  }
  return Array.from(new Set(entities)).slice(0, Math.max(1, Number(limit) || 5));
}

export function getLatestConversationSubject(historySource = []) {
  return getRecentContextEntities(historySource, 1)[0] || '';
}

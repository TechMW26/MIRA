const SIMPLE_GREETING_PATTERN = /^\s*(?:hi+|hii+|hello+|hey+|hey\s+there|hello\s+there|yo|sup|howdy|hola|namaste|good\s+(?:morning|afternoon|evening))(?:[!.?\s]+)?$/i;

export function isSimpleGreeting(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return value.split(/\s+/).length <= 6 && SIMPLE_GREETING_PATTERN.test(value);
}

export function buildGreetingResponse(text = '') {
  const value = String(text || '').toLowerCase();
  if (/good\s+morning/.test(value)) return 'Good morning! What can I help you with?';
  if (/good\s+afternoon/.test(value)) return 'Good afternoon! What can I help you with?';
  if (/good\s+evening/.test(value)) return 'Good evening! What can I help you with?';
  return 'Hey! What can I help you with?';
}

export function getMostRecentAssistantMessage(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'assistant') return history[index];
  }
  return null;
}

const GREETING_WORDS_PATTERN = /^(?:(?:hi+|hii+|hello+|hey+|heya+|yo+|sup+|ssup+|wassup|wazzup|howdy|hola|namaste)\s*){1,3}$/i;
const GREETING_CHECK_IN_PATTERN = /^(?:(?:hi+|hii+|hello+|hey+|heya+|yo+|sup+|ssup+|wassup|wazzup|howdy|hola|namaste)\s+)?(?:what'?s\s+up|whats\s+up|how\s+are\s+(?:you|u)|how'?s\s+it\s+going|good\s+(?:morning|afternoon|evening))$/i;
const IMAGE_GEN_PATTERN = /\[IMAGE_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;

export function isSimpleGreeting(text = '') {
  const value = String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return false;
  if (value.split(/\s+/).length > 6) return false;
  return GREETING_WORDS_PATTERN.test(value) || GREETING_CHECK_IN_PATTERN.test(value);
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

export function getPreviousGeneratedImageContext(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== 'assistant') continue;
    const content = String(message?.promptContent || message?.content || '');
    const prompt = content.match(IMAGE_GEN_PATTERN)?.[1]?.trim() || '';
    if (!prompt) continue;
    const generatedImage = message?.generatedMedia?.images?.[0];
    const referenceImage = typeof generatedImage?.url === 'string'
      ? generatedImage.url.trim()
      : typeof message?.image === 'string'
        ? message.image.trim()
        : '';
    return { prompt, referenceImage };
  }
  return null;
}

export function isPreviousImageEditRequest(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 500) return false;
  const action = /\b(edit|modify|refine|retouch|adjust|tweak|change|replace|remove|add|swap|restyle|rework|fix|improve|redo|regenerate|make|turn)\b/i;
  const explicitReference = /\b(previous|last|same|this|that)\s+(?:generated\s+)?(?:image|photo|picture|render|result|output|one)\b|\b(?:edit|modify|refine|retouch|adjust|tweak|change|replace|remove|add|swap|restyle|rework|fix|improve|redo|regenerate|make|turn)\s+(?:it|this|that|the\s+(?:image|photo|picture|render))\b/i;
  return action.test(value) && explicitReference.test(value);
}

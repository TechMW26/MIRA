const IMAGE_GEN_PATTERN = /\[IMAGE_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const INVALID_PROMPT_PATTERN = /(?:^|\[)(?:using tools?|mira_tool)|^(?:\.{2,}|…+|image|picture|photo|generated image)$/i;
const PROMPT_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'to', 'for', 'in', 'on', 'with', 'please',
  'generate', 'create', 'make', 'draw', 'render', 'show', 'image', 'picture',
  'photo', 'photograph', 'art', 'artwork', 'me', 'my', 'this', 'that',
]);

export function cleanImagePrompt(text = '') {
  return String(text || '')
    .replace(/\[IMAGE_GEN(?:\:\s*|\]\s*)/gi, '')
    .replace(/\]$/g, '')
    .replace(/^generated\s+an\s+image\s+from\s+(?:this\s+)?(?:refined\s+)?prompt[:\s-]*/i, '')
    .replace(/^create\s+a\s+concise\s+but\s+highly\s+detailed\s+visual\s+prompt[:\s-]*/i, '')
    .replace(/^image\s+generation\s+request[:\s-]*/i, '')
    .replace(/^(?:sure|okay|absolutely|here'?s|here is|i can|i will)[\s,:-]+/i, '')
    .replace(/^(?:please\s+)?(?:generate|create|make|draw|render|show)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|photograph|artwork?)\s+(?:of\s+)?/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptTerms(text = '') {
  return cleanImagePrompt(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !PROMPT_STOPWORDS.has(term));
}

export function isUsableImagePrompt(candidate = '', anchor = '') {
  const prompt = cleanImagePrompt(candidate);
  if (prompt.length < 3 || INVALID_PROMPT_PATTERN.test(prompt)) return false;
  const anchorTerms = promptTerms(anchor);
  if (!anchorTerms.length) return true;
  const candidateText = prompt.toLowerCase();
  return anchorTerms.some((term) => candidateText.includes(term));
}

export function normalizeImageGenerationOutput(modelText = '', userText = '', previousPrompt = '') {
  const markerPrompt = String(modelText || '').match(IMAGE_GEN_PATTERN)?.[1]?.trim();
  const candidate = cleanImagePrompt(markerPrompt || modelText);
  const prior = cleanImagePrompt(previousPrompt);
  const correction = cleanImagePrompt(userText);

  let prompt;
  if (prior) {
    const matchesPrior = isUsableImagePrompt(candidate, prior);
    const matchesCorrection = !promptTerms(correction).length || isUsableImagePrompt(candidate, correction);
    prompt = matchesPrior && matchesCorrection
      ? candidate
      : [prior, correction].filter(Boolean).join(', ');
  } else {
    prompt = isUsableImagePrompt(candidate, correction) ? candidate : correction;
  }

  return `[IMAGE_GEN: ${prompt || 'A high-quality, detailed image based on the user request'}]`;
}

export function imagePromptSeed(prompt = '') {
  const value = cleanImagePrompt(prompt);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 999999) + 1;
}

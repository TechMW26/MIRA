function isConversationalDocumentLine(line) {
  const text = String(line || '').trim().replace(/^#{1,6}\s+/, '');
  if (!text) return false;
  return /^(sure|okay|ok|absolutely|of course|certainly)[,!\s-]*(here(?:'s| is)|below is|i(?:'ve| have))?/i.test(text)
    || /^(here(?:'s| is)|below is|the following is)\b[\s\S]*\b(pdf|docx|word|pptx|powerpoint|presentation|document|file|markdown)\b[\s\S]*:?$/i.test(text)
    || /^i(?:'ve| have)\s+(created|generated|prepared|drafted|made)\b[\s\S]*:?$/i.test(text)
    || /^as requested\b[\s\S]*:?$/i.test(text)
    || /^here\s+is\s+the\s+complete\b[\s\S]*:?$/i.test(text);
}

function isDocumentMetaLine(line) {
  const text = String(line || '').trim().replace(/^#{1,6}\s+/, '');
  if (!text) return false;
  return /^\[(page\s+\d+|cover page|front cover|back cover|download button|image:\s*[^\]]+|note:\s*[^\]]*download[^\]]*)\]$/i.test(text)
    || /^download\s+(the\s+)?[\w\s-]*(pdf|docx|word document|pptx|powerpoint|presentation)\s*$/i.test(text)
    || /^\[?note:\s*[\s\S]*\b(download button|google drive|download the pdf|download the document)\b[\s\S]*\]?$/i.test(text);
}

export function sanitizeDocumentContent(content = '') {
  const original = String(content || '').trim();
  if (!original) return '';

  let text = original
    .replace(/^\s*```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/\[Download[^\]]*(?:PDF|DOCX|PPTX|Word|PowerPoint|Presentation|Slides)[^\]]*\]\([^)]*\)/gi, '')
    .replace(/^\s*\[Download Button\]\s*$/gim, '');

  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && (isConversationalDocumentLine(lines[0]) || /^#{1,6}\s*$/.test(lines[0].trim()))) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }

  text = lines
    .filter((line) => !isDocumentMetaLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || original;
}

// Only explicit creation/export intent should trigger a download.
export function detectDocumentRequest(message = '', hasFileAttachments = false) {
  void hasFileAttachments;
  const lower = String(message).toLowerCase();
  const createIntent = /\b(create|generate|make|export|download|write|produce|build|give me|save as|convert to)\b/.test(lower);
  if (!createIntent) return null;

  if (/\b(as|to|in|a|the)?\s*(pdf)\b/.test(lower)) return 'pdf';
  if (/\b(as|to|in|a|the)?\s*(docx|word document|word file)\b/.test(lower)) return 'docx';
  if (/\b(as|to|in|a|the)?\s*(pptx|powerpoint|presentation|slides)\b/.test(lower)) return 'pptx';
  if (/\b(download|export|save)\b[\s\S]{0,40}\b(file|document)\b/.test(lower)) return 'pdf';
  return null;
}

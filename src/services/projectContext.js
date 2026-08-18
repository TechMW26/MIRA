const TURN_TEXT_LIMIT = 900;
const DOCUMENT_TEXT_LIMIT = 1100;
const IMAGE_TEXT_LIMIT = 800;
const DEFAULT_PROMPT_LIMIT = 9000;

function cleanSharedText(value = '') {
  return String(value || '')
    .replace(/data:[^;\s]+;base64,[a-z0-9+/=]+/gi, '[image data omitted]')
    .replace(/\b[a-z0-9+/]{600,}={0,2}\b/gi, '[binary data omitted]')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeProjectText(value = '', limit = TURN_TEXT_LIMIT) {
  const cleaned = cleanSharedText(value);
  if (!cleaned) return '';
  if (cleaned.length <= limit) return cleaned;

  const window = cleaned.slice(0, limit + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
    window.lastIndexOf('; '),
  );
  const cutoff = sentenceEnd >= Math.floor(limit * 0.55) ? sentenceEnd + 1 : limit;
  return `${window.slice(0, cutoff).trim()}…`;
}

export function buildProjectContextTurn({
  userText = '',
  assistantText = '',
  attachments = [],
  imageAnalyses = [],
  author = {},
  conversationTitle = '',
  timestamp = Date.now(),
} = {}) {
  const request = summarizeProjectText(userText);
  const outcome = summarizeProjectText(assistantText);
  const documents = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment && !attachment.isImage)
    .map((attachment) => ({
      name: summarizeProjectText(attachment.name || 'Untitled document', 180),
      type: summarizeProjectText(attachment.type || '', 100),
      summary: summarizeProjectText(
        attachment.text || attachment.parsedText || attachment.parseError || 'No text could be extracted.',
        DOCUMENT_TEXT_LIMIT,
      ),
    }))
    .filter((document) => document.name && document.summary)
    .slice(0, 8);
  const images = (Array.isArray(imageAnalyses) ? imageAnalyses : [])
    .map((image, index) => ({
      name: summarizeProjectText(image?.name || `Image ${index + 1}`, 180),
      summary: summarizeProjectText(image?.summary || image?.text || '', IMAGE_TEXT_LIMIT),
    }))
    .filter((image) => image.summary)
    .slice(0, 8);

  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    conversationTitle: summarizeProjectText(conversationTitle || 'Project chat', 180),
    author: {
      uid: summarizeProjectText(author?.uid || '', 128),
      displayName: summarizeProjectText(author?.displayName || author?.email || 'Project member', 120),
    },
    request,
    outcome,
    documents,
    images,
  };
}

function appendWithinLimit(lines, line, state) {
  const value = String(line || '').trim();
  if (!value) return false;
  const nextLength = state.length + value.length + 1;
  if (nextLength > state.limit) return false;
  lines.push(value);
  state.length = nextLength;
  return true;
}

export function buildProjectContextPrompt(projectContext, {
  currentConversationId = '',
  maxChars = DEFAULT_PROMPT_LIMIT,
} = {}) {
  const conversations = projectContext?.conversations;
  if (!conversations || typeof conversations !== 'object') return '';

  const turns = [];
  Object.entries(conversations).forEach(([conversationId, conversation]) => {
    Object.entries(conversation?.turns || {}).forEach(([turnId, turn]) => {
      if (!turn || typeof turn !== 'object') return;
      turns.push({ ...turn, turnId, conversationId });
    });
  });
  if (!turns.length) return '';

  turns.sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
  const selectedTurns = turns
    .sort((left, right) => {
      const leftOther = left.conversationId !== currentConversationId ? 1 : 0;
      const rightOther = right.conversationId !== currentConversationId ? 1 : 0;
      return rightOther - leftOther || Number(right.timestamp || 0) - Number(left.timestamp || 0);
    })
    .slice(0, 14);

  const lines = [];
  const state = { length: 0, limit: Math.max(1800, Number(maxChars) || DEFAULT_PROMPT_LIMIT) };
  appendWithinLimit(lines, 'PROJECT SHARED CONTEXT (summarized across chats in this project)', state);
  appendWithinLimit(lines, 'Use this as background knowledge. Prefer the current user request and current-chat evidence if anything conflicts. Do not claim these summaries are verbatim source text.', state);

  const documents = [];
  const images = [];
  selectedTurns.forEach((turn) => {
    const scope = turn.conversationId === currentConversationId ? 'this chat' : 'another project chat';
    const title = summarizeProjectText(turn.conversationTitle || 'Project chat', 140);
    const author = summarizeProjectText(turn.author?.displayName || 'Project member', 100);
    const request = summarizeProjectText(turn.request, TURN_TEXT_LIMIT);
    const outcome = summarizeProjectText(turn.outcome, TURN_TEXT_LIMIT);
    const digest = [`[${title}; ${scope}; ${author}]`, request && `Request: ${request}`, outcome && `Outcome: ${outcome}`]
      .filter(Boolean)
      .join(' ');
    appendWithinLimit(lines, digest, state);
    (turn.documents || []).forEach((document) => documents.push({ ...document, title }));
    (turn.images || []).forEach((image) => images.push({ ...image, title }));
  });

  const seenDocuments = new Set();
  documents.forEach((document) => {
    const key = `${String(document.name || '').toLowerCase()}|${String(document.summary || '').toLowerCase()}`;
    if (!document.summary || seenDocuments.has(key)) return;
    seenDocuments.add(key);
    appendWithinLimit(
      lines,
      `Document digest — ${summarizeProjectText(document.name, 180)} (${summarizeProjectText(document.title, 120)}): ${summarizeProjectText(document.summary, DOCUMENT_TEXT_LIMIT)}`,
      state,
    );
  });

  const seenImages = new Set();
  images.forEach((image) => {
    const key = `${String(image.name || '').toLowerCase()}|${String(image.summary || '').toLowerCase()}`;
    if (!image.summary || seenImages.has(key)) return;
    seenImages.add(key);
    appendWithinLimit(
      lines,
      `Image digest — ${summarizeProjectText(image.name, 180)} (${summarizeProjectText(image.title, 120)}): ${summarizeProjectText(image.summary, IMAGE_TEXT_LIMIT)}`,
      state,
    );
  });

  if (lines.length <= 2) return '';
  return `${lines.join('\n')}\nEND PROJECT SHARED CONTEXT`;
}

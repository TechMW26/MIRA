import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, stopChatGeneration } from '../services/api';
import { analyzeImage } from '../services/imageAnalysis.js';
import { processQuery } from '../services/engine';
import { assessAndRefinePrompt, shouldRunEnhancer } from '../services/promptEnhancer';
import {
  createConversation,
  addMessage,
  updateMessage,
  deleteMessage,
  updateConversation,
  addConversationToProject,
  subscribeMessages,
} from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useChatContext } from '../contexts/ChatContext';
import useUserProfile from './useUserProfile';
import { generateSmartTitle, buildAdaptiveContext } from '../utils/helpers';
import {
  cacheProfile,
  decideContextMode,
  buildLearnedFactsBlock,
  processRememberMarkers,
  sanitizeMemoryLeakStyleResponse,
} from '../services/knowledgeBank';
import { makeCacheKey, getCachedResponse, setCachedResponse } from '../services/responseCache';
import { detectDocumentRequest, exportDocument, sanitizeDocumentContent } from '../utils/documentExport';
import { MIRA_IDENTITY_PROMPT } from '../config/systemPrompt';

const CURRENT_ATTACHMENT_CHAR_LIMIT = 60000;
const HISTORY_ATTACHMENT_CHAR_LIMIT = 16000;
const MAX_HISTORY_MESSAGES_FOR_MODEL = 24;
const MAX_HISTORY_CHARS_FOR_MODEL = 18000;
const MAX_GREETING_HISTORY_MESSAGES = 6;
const MAX_GREETING_HISTORY_CHARS = 4000;
const IMAGE_GEN_PATTERN = /\[IMAGE_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const VIDEO_GEN_PATTERN = /\[VIDEO_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const MEDIA_REQUEST_PATTERN = /\b(video|videos|clip|clips|media|reel|reels|youtube|instagram|social\s+posts?)\b|\b(show|find|fetch|get|search|check|look\s+up|more)\b[^.!?]{0,40}\b(images|photos|pictures)\b|\b(images|photos|pictures)\b[^.!?]{0,40}\b(show|find|fetch|get|search|check|look\s+up|more)\b/i;
const EXPLICIT_VISUAL_WEB_SEARCH_PATTERN = /\b(who\s+is\s+this|who\s+is\s+in\s+this\s+image|find\s+this\s+online|find\s+this\s+on\s+the\s+web|search\s+this\s+product|search\s+this\s+image|search\s+this\s+online|look\s+this\s+up|look\s+this\s+up\s+online|check\s+this\s+online|verify\s+this\s+online|find\s+out\s+what\s+product\s+this\s+is|search\s+the\s+web\s+for\s+this|identify\s+this\s+online)\b/i;
const CONTEXTUAL_DEVICE_MEDIA_PATTERN = /\b(this|that|the)\s+(device|product|tool|item|object|thing|model|prototype|machine|system)\b|\b(tell me more|more about|details about|background on|explain)\b[^.!?]{0,70}\b(this|that|it|device|product|object|thing|model|prototype|machine|system)\b/i;
const CONTEXT_REFERENCE_PATTERN = /\b(it|its|this|that|these|those|they|them|the\s+(device|product|tool|item|object|thing|company|brand|manufacturer|maker|producer|person|model|app|software|platform|service|system|prototype|machine))\b/i;
const CONTEXTUAL_WEB_RESEARCH_PATTERN = /\b(company|companies|manufacturer|manufactures?|producer|produces?|producing|maker|made\s+by|built\s+by|created\s+by|developed\s+by|owner|owned\s+by|founder|team|organization|brand|official|website|source|origin|specs?|features?|pricing|price|cost|availability|launch|release|details?|in[-\s]?depth|deep\s+dive|full\s+information|complete\s+information|let\s+me\s+know|tell\s+me\s+more|more\s+about|background|research|explain)\b/i;
const SHORT_CONTEXT_FOLLOWUP_PATTERN = /\b(are\s+you\s+sure|sure\s+about\s+that|really|seriously|wait|why\??|how\s+so|what\s+do\s+you\s+mean|continue|go\s+on|tell\s+me\s+more|more|elaborate|explain\s+that)\b/i;
const SEARCH_WORTHY_CONTEXT_PATTERN = /\b(company|manufacturer|maker|producer|brand|official\s+website|specs?|pricing|price|cost|availability|launch|release|latest|current|current\s+status|who\s+makes|who\s+owns|what\s+company|where\s+to\s+buy|how\s+much|how\s+many)\b/i;
const SIMPLE_GREETING_PATTERN = /^\s*(?:hi|hello|hey|hey there|hello there|yo|sup|good\s+(?:morning|afternoon|evening))(?:[!.?\s]+)?$/i;
const CONTEXT_ENTITY_STOP = new Set(['I', 'The', 'A', 'An', 'It', 'This', 'That', 'These', 'Those', 'You', 'He', 'She', 'We', 'They', 'My', 'Your', 'MIRA', 'AI', 'PDF', 'DOCX', 'PPTX']);
const TEXT_ENTITY_RESEARCH_PATTERN = /\b(tell\s+me\s+about|tell\s+me\s+more\s+about|details?\s+about|information\s+about|info\s+about|background\s+on|research|explain|what\s+is|what\s+are|what\s+an|what\s+a|what's|overview\s+of|in\s+detail|deep\s+dive|let\s+me\s+know\s+what)\b/i;
const LOCKED_TRIGGER_PATTERN = /\b(nude|nudity|naked|explicit|uncensored|adult\s*content|erotic|porn|pornographic|xxx|18\+|lewd|sexual\s*content|sex|nsfw|fetish|hardcore|boobs?|breasts?|nipples?|genitals?|penis|vagina|anal|blowjob|handjob|cum|orgasm|hentai|bypass|jailbreak|exploit|malware|ransomware|phishing|ddos|credit\s*card\s*fraud|social\s*security\s*number|ssn|doxx|private\s*data|steal\s*data|illegal|unethical|forbidden|restricted)\b/i;

function attachmentSignature(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  return attachments
    .map((att) => `${att?.name || ''}:${att?.type || ''}:${att?.isImage ? 'i' : 't'}`)
    .join('|');
}

function messageFingerprint(message = {}) {
  return [
    message?.role || '',
    String(message?.content || ''),
    attachmentSignature(message?.attachments || []),
  ].join('::');
}

function isMediaRequest(text = '') {
  return MEDIA_REQUEST_PATTERN.test(String(text || ''));
}

function isMediaOnlyRequest(text = '') {
  const value = String(text || '').trim();
  if (!isMediaRequest(value)) return false;
  const asksForSubstantiveAnswer = /\b(who|what|why|how|explain|tell\s+me\s+more|details?|overview|summary|analy[sz]e|compare|review|price|cost|specs?|features?|benefits?|identify|verify|latest|current|news|research|information|info)\b/i.test(value);
  const asksForMediaAction = /\b(show|find|fetch|get|search|check|look\s+up|pull|give)\b[^.!?]{0,70}\b(videos?|clips?|media|images?|photos?|pictures?|reels?|youtube|instagram)\b|\b(more|related|relevant)?\s*(videos?|clips?|media|images?|photos?|pictures?|reels?)\b/i.test(value);
  return asksForMediaAction && !asksForSubstantiveAnswer;
}

function needsVisualSearchAnchor(text = '', hasImages = false) {
  if (!hasImages) return false;
  const value = String(text || '').trim();
  return EXPLICIT_VISUAL_WEB_SEARCH_PATTERN.test(value);
}

function cleanVisualSearchAnchor(raw = '') {
  const cleaned = String(raw || '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/^\s*(?:search\s+query|query|keywords?)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (/\b(i\s+(cannot|can't|do not|don't)|unable|not\s+able|can't\s+access|cannot\s+access|cannot\s+view|can't\s+view|not\s+visible|text[-\s]?based)\b/i.test(cleaned)) return '';
  return cleaned;
}

const VISUAL_ENTITY_STOP = new Set(['the', 'this', 'that', 'these', 'those', 'image', 'photo', 'picture', 'device', 'product', 'object', 'item', 'thing', 'prototype', 'machine', 'system', 'technology', 'brand', 'visible', 'shown', 'search', 'query']);
const VISUAL_ENTITY_DESCRIPTOR = new Set(['device', 'product', 'object', 'item', 'thing', 'prototype', 'machine', 'system', 'technology', 'installation', 'based', 'powered']);

function normalizeSearchWords(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function quoteSearchPhrase(text = '') {
  const value = String(text || '').replace(/["'`“”‘’]/g, '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return /\s/.test(value) ? `"${value}"` : value;
}

function trimVisualEntityCandidate(candidate = '') {
  const parts = String(candidate || '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  const descriptorIndex = parts.findIndex((part, index) => {
    const word = normalizeSearchWords(part)[0] || '';
    return index >= 2 && (VISUAL_ENTITY_DESCRIPTOR.has(word) || /^(?:[a-z]+-)?(?:based|powered)$/i.test(part));
  });
  const trimmed = descriptorIndex >= 2 ? parts.slice(0, descriptorIndex) : parts;
  while (trimmed.length > 1) {
    const lastWord = normalizeSearchWords(trimmed[trimmed.length - 1])[0] || '';
    if (!VISUAL_ENTITY_DESCRIPTOR.has(lastWord)) break;
    trimmed.pop();
  }
  return trimmed.join(' ');
}

function extractVisualEntityPhrase(raw = '') {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';

  const candidates = [];
  for (const match of value.matchAll(/["“]([^"”]{2,80})["”]/g)) {
    candidates.push(match[1]);
  }
  candidates.push(...(value.match(/\b[A-Z][A-Za-z0-9&+.-]*(?:\s+[A-Z][A-Za-z0-9&+.-]*){1,5}\b/g) || []));
  candidates.push(...(value.match(/\b[A-Z0-9]{2,}(?:[-\s]+[A-Z0-9]{2,}){0,4}\b/g) || []));

  const firstSegment = value.split(/[,;|:()]/)[0]?.trim() || '';
  if (firstSegment.split(/\s+/).length <= 5) candidates.push(firstSegment);

  for (const candidate of candidates) {
    const cleaned = trimVisualEntityCandidate(String(candidate || '').replace(/^(?:the|a|an)\s+/i, '').replace(/["'`“”‘’]/g, '').trim());
    const words = normalizeSearchWords(cleaned);
    if (!cleaned || words.length === 0 || words.every((word) => VISUAL_ENTITY_STOP.has(word))) continue;
    return cleaned.slice(0, 80);
  }
  return '';
}

function buildVisualSearchScope(anchor = '', current = '') {
  const entity = extractVisualEntityPhrase(anchor);
  const exactEntity = quoteSearchPhrase(entity);
  const entityWords = new Set(normalizeSearchWords(entity));
  const descriptorMatches = String(anchor || '').toLowerCase().match(/\b(?:[a-z]+[-\s])?(?:based|powered)|\b(?:device|product|prototype|machine|system|technology|installation|air\s+purifier|bio\s*reactor|photobioreactor)\b/g) || [];
  const descriptors = [];
  for (const match of descriptorMatches) {
    const term = match.replace(/\s+/g, '-').trim();
    const words = normalizeSearchWords(term);
    if (!term || words.every((word) => entityWords.has(word)) || descriptors.includes(term)) continue;
    descriptors.push(term);
  }

  const intentWords = [];
  if (/\b(company|manufacturer|maker|producer|made\s+by|built\s+by|created\s+by|official|website)\b/i.test(current)) intentWords.push('manufacturer');
  if (/\b(specs?|features?|price|cost|availability|launch|release)\b/i.test(current)) intentWords.push('details');

  const base = exactEntity || cleanVisualSearchAnchor(anchor);
  const query = [base, ...descriptors.slice(0, 3), ...intentWords].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const mediaQuery = exactEntity || query;
  return { entity, query, mediaQuery };
}

const TEXT_ENTITY_STOP = new Set(['tell', 'me', 'about', 'more', 'details', 'detail', 'information', 'info', 'background', 'research', 'explain', 'what', 'is', 'whats', 'overview', 'deep', 'dive', 'in', 'detail', 'the', 'a', 'an', 'this', 'that', 'it', 'please', 'can', 'you', 'know', 'latest', 'current', 'complete', 'full', 'video', 'videos', 'image', 'images', 'media']);

function titleCaseEntity(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.length <= 3 && /^[A-Z0-9]+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function canonicalizeTextEntity(value = '') {
  const normalized = String(value || '')
    .replace(/["'`“”‘’]/g, '')
    .replace(/\b(?:algae\s*tree|algae?tree|alga\s*tree|algatree)\b/ig, 'Algae Tree')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (/\bAlgae Tree\b/i.test(normalized)) return 'Algae Tree';
  return /[A-Z]/.test(normalized) ? normalized : titleCaseEntity(normalized);
}

function extractTextResearchEntity(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || (!TEXT_ENTITY_RESEARCH_PATTERN.test(value) && !isMediaRequest(value))) return '';

  const quoted = value.match(/["“]([^"”]{2,80})["”]/)?.[1]?.trim();
  if (quoted) return canonicalizeTextEntity(quoted);

  const withoutIntent = value
    .replace(/\b(tell\s+me\s+(?:more\s+)?about|details?\s+about|information\s+about|info\s+about|background\s+on|overview\s+of|deep\s+dive\s+(?:on|into)|research|explain|what\s+is|what\s+are|what\s+an|what\s+a|what's|let\s+me\s+know\s+what)\b/ig, ' ')
    .replace(/\b(in\s+detail|complete\s+information|full\s+information|please|videos?|images?|media|clips?|photos?|pictures?)\b/ig, ' ')
    .replace(/[?!.,;:()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const proper = withoutIntent.match(/\b[A-Z][A-Za-z0-9&+.-]*(?:\s+[A-Z][A-Za-z0-9&+.-]*){0,5}\b/)?.[0]?.trim();
  if (proper && !TEXT_ENTITY_STOP.has(proper.toLowerCase())) return canonicalizeTextEntity(proper);

  const words = withoutIntent.split(/\s+/).filter((word) => {
    const normalized = normalizeSearchWords(word)[0] || '';
    return normalized.length >= 3 && !TEXT_ENTITY_STOP.has(normalized);
  });

  if (!words.length) return '';
  return canonicalizeTextEntity(words.slice(0, 5).join(' '));
}

function buildTextResearchMediaScope(text = '') {
  const entity = extractTextResearchEntity(text);
  if (!entity) return null;
  const exactEntity = quoteSearchPhrase(entity);
  const intentWords = [];
  if (/\b(company|manufacturer|maker|producer|made\s+by|built\s+by|created\s+by|official|website)\b/i.test(text)) intentWords.push('manufacturer');
  if (/\b(specs?|features?|price|cost|availability|launch|release|details?|detail|information|info|overview|background)\b/i.test(text)) intentWords.push('details');
  return {
    entity,
    query: [exactEntity, ...intentWords.slice(0, 2)].filter(Boolean).join(' ').trim(),
    mediaQuery: exactEntity || entity,
  };
}

function buildDocumentVisualScope(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const topicMatch = value.match(/\b(?:about|on|for|regarding|covering|of)\s+(.{3,160})/i);
  const rawTopic = (topicMatch?.[1] || value)
    .replace(/\b(create|make|generate|prepare|download|export|build|write|draft|as|a|an|the|pdf|docx|pptx|word|powerpoint|presentation|slides?|document|report|file|with|including|include|images?|pictures?|photos?|visuals?|diagrams?|charts?|detailed|detail|in-depth|complete|full)\b/ig, ' ')
    .replace(/[?!.,;:()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rawTopic) return null;
  const entity = extractTextResearchEntity(`tell me about ${rawTopic}`) || canonicalizeTextEntity(rawTopic.split(/\s+/).slice(0, 6).join(' '));
  if (!entity || entity.length < 3) return null;
  const exactEntity = quoteSearchPhrase(entity);
  return {
    entity,
    query: [exactEntity, 'details'].filter(Boolean).join(' ').trim(),
    mediaQuery: exactEntity || entity,
  };
}

function imageMarkdownLine(image, index = 0) {
  const src = image?.thumbnail || image?.url || '';
  if (!/^https?:\/\//i.test(src)) return '';
  const caption = cleanVisualSearchAnchor(image?.title || image?.alt || `Reference image ${index + 1}`)
    .replace(/[\[\]()]/g, '')
    .slice(0, 90)
    || `Reference image ${index + 1}`;
  return `![${caption}](${src})`;
}

function isReliableDocumentImageSrc(src = '', verifiedImages = []) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (/^data:/i.test(value)) return false;
  if (/\b(example\.com|placeholder\.com|placehold\.co|dummyimage|google\.com\/search|googleusercontent\.com\/proxy)\b/i.test(value)) return false;
  if (!/^(https?:\/\/|\/api\/image\?url=)/i.test(value)) return false;
  if (verifiedImages.some((image) => value === image.url || value === image.thumbnail)) return true;
  return /\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(value) || /\/api\/image\?url=/i.test(value) || /\/th\/id\//i.test(value);
}

function ensureVerifiedDocumentImages(content = '', verifiedImages = []) {
  const images = (verifiedImages || [])
    .map((image, index) => ({ ...image, markdown: imageMarkdownLine(image, index) }))
    .filter((image) => image.markdown);
  let replacementIndex = 0;
  let reliableCount = 0;
  const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  let nextContent = String(content || '').replace(imagePattern, (full, _alt, src) => {
    if (isReliableDocumentImageSrc(src, images)) {
      reliableCount += 1;
      return full;
    }
    const replacement = images[replacementIndex]?.markdown || '';
    if (replacement) {
      replacementIndex += 1;
      reliableCount += 1;
      return replacement;
    }
    return '';
  });

  const targetCount = Math.min(2, images.length);
  if (reliableCount < targetCount) {
    const extra = images.slice(replacementIndex, replacementIndex + (targetCount - reliableCount)).map((image) => image.markdown);
    if (extra.length) {
      nextContent = `${nextContent.trim()}\n\n## Reference Images\n\n${extra.join('\n\n')}`;
    }
  }

  return nextContent.replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchDocumentVisualImages(scope) {
  if (!scope?.query) return [];
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: scope.query,
        includeMedia: true,
        mediaQuery: scope.mediaQuery || scope.query,
        anchor: scope.entity || scope.mediaQuery || scope.query,
        strictAnchor: true,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const images = Array.isArray(data.media?.images) ? data.media.images : [];
    return images
      .filter((image) => /^https?:\/\//i.test(image?.thumbnail || image?.url || ''))
      .slice(0, 3);
  } catch (err) {
    console.warn('Document image search failed:', err?.message || err);
    return [];
  }
}

function wantsContextualDeviceMedia(text = '') {
  return CONTEXTUAL_DEVICE_MEDIA_PATTERN.test(String(text || ''));
}

function extractContextEntities(text = '') {
  const matches = String(text || '')
    .slice(0, 2600)
    .match(/"([^"]{2,60})"|“([^”]{2,60})”|\b([A-Z][A-Za-z0-9]+(?:[-\s]+[A-Z][A-Za-z0-9]+){0,4})\b|\b([A-Z0-9]{2,}(?:[-\s]+[A-Z0-9]{2,}){0,3})\b/g) || [];

  return Array.from(new Set(
    matches
      .map((value) => value.replace(/["“”]/g, '').trim())
      .filter((value) => value.length > 2 && !CONTEXT_ENTITY_STOP.has(value))
  ));
}

function getRecentContextEntities(historySource = []) {
  const recent = Array.isArray(historySource) ? historySource.slice(-8) : [];
  const entities = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const text = normalizeMessageContent(message?.promptContent || message?.content || '');
    entities.push(...extractContextEntities(text));
    if (message?.media?.query) entities.push(...extractContextEntities(message.media.query));
  }
  return Array.from(new Set(entities)).slice(0, 5);
}

function getRecentContextAnchor(historySource = []) {
  const recent = Array.isArray(historySource) ? historySource.slice(-6) : [];
  const source = [...recent].reverse().find((message) => {
    const text = normalizeMessageContent(message?.content || message?.promptContent || '');
    return message?.role === 'assistant' && text.length > 20;
  });
  return normalizeMessageContent(source?.content || source?.promptContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function needsContextualWebSearch(text = '', historySource = []) {
  const value = String(text || '');
  if (!CONTEXT_REFERENCE_PATTERN.test(value)) return false;
  if (!SEARCH_WORTHY_CONTEXT_PATTERN.test(value)) return false;
  if (!CONTEXTUAL_WEB_RESEARCH_PATTERN.test(value)) return false;
  return getRecentContextEntities(historySource).length > 0 || getRecentContextAnchor(historySource).length > 0;
}

// Phrases MIRA emits when its own knowledge falls short — it lacks live,
// current, or factual data. When one of these appears in an answer AND the user
// did not already have web search enabled, the host automatically runs a web
// search and regenerates a grounded reply. This lets MIRA reach for the
// internet on its own when it is unable to answer, instead of only when web
// access is toggled on manually.
const KNOWLEDGE_GAP_PATTERN = new RegExp([
  /i (?:do not|don'?t) have (?:reliable|accurate|current|real[- ]?time|up[- ]?to[- ]?date|the latest|specific|detailed|enough|any)? ?(?:information|data|details|knowledge)/,
  /i (?:do not|don'?t) have access to (?:real[- ]?time|current|live|up[- ]?to[- ]?date|the internet|the web|online)/,
  /i(?:'?m| am) (?:not able|unable) to (?:access|browse|provide|retrieve|look up|search|fetch)/,
  /i (?:cannot|can'?t) (?:access|browse|provide|retrieve|look up|search) (?:real[- ]?time|current|live|the internet|the web|up[- ]?to[- ]?date)/,
  /(?:as of |up to )?my (?:last )?(?:knowledge|training)(?: data)? (?:cut[- ]?off|update)/,
  /my training data (?:only )?(?:goes|extends|includes|ends|stops)/,
  /knowledge cut[- ]?off/,
  /beyond my (?:knowledge|training|current)/,
  /i(?:'?m| am) not (?:sure|certain|aware) (?:about|of) the (?:latest|current|most recent|exact)/,
  /(?:please|you (?:may|might|can|could)(?: want to)?) (?:check|refer to|visit|consult) (?:the )?(?:official|their|its)? ?(?:website|sources?) for (?:the )?(?:latest|current|most recent|up[- ]?to[- ]?date)/,
  /i recommend (?:checking|visiting|consulting) (?:the )?(?:official|their|its|a)? ?(?:website|latest|sources?|news)/,
].map((part) => part.source).join('|'), 'i');

function indicatesKnowledgeGap(text = '') {
  const value = String(text || '');
  if (value.length < 12) return false;
  return KNOWLEDGE_GAP_PATTERN.test(value);
}

function cleanImagePrompt(text = '') {
  return String(text || '')
    .replace(/\[IMAGE_GEN(?:\:\s*|\]\s*)/gi, '')
    .replace(/\]$/g, '')
    .replace(/^generated\s+an\s+image\s+from\s+(?:this\s+)?(?:refined\s+)?prompt[:\s-]*/i, '')
    .replace(/^create\s+a\s+concise\s+but\s+highly\s+detailed\s+visual\s+prompt[:\s-]*/i, '')
    .replace(/^image\s+generation\s+request[:\s-]*/i, '')
    .replace(/^(sure|okay|absolutely|here'?s|here is|i can|i will)[\s,:-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVideoPrompt(text = '') {
  return String(text || '')
    .replace(/\[VIDEO_GEN(?:\:\s*|\]\s*)/gi, '')
    .replace(/\]$/g, '')
    .replace(/^generated\s+a\s+video\s+from\s+(?:this\s+)?(?:refined\s+)?prompt[:\s-]*/i, '')
    .replace(/^create\s+a\s+concise\s+but\s+highly\s+detailed\s+cinematic\s+prompt[:\s-]*/i, '')
    .replace(/^video\s+generation\s+request[:\s-]*/i, '')
    .replace(/^(sure|okay|absolutely|here'?s|here is|i can|i will)[\s,:-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageGenerationOutput(modelText, userText, previousPrompt = '') {
  const markerPrompt = modelText?.match(IMAGE_GEN_PATTERN)?.[1]?.trim();
  const currentPrompt = cleanImagePrompt(markerPrompt || modelText || userText);
  const priorPrompt = cleanImagePrompt(previousPrompt);
  const correctionText = cleanImagePrompt(userText);

  let prompt = currentPrompt || priorPrompt || correctionText;
  if (priorPrompt && correctionText) {
    const sameAsPrevious = currentPrompt && cleanImagePrompt(currentPrompt) === priorPrompt;
    if (!sameAsPrevious) {
      prompt = `${priorPrompt}, ${correctionText}`.replace(/\s+/g, ' ').trim();
    }
  }

  const fallback = 'A high-quality, detailed image based on the user request';
  return `[IMAGE_GEN: ${prompt || fallback}]`;
}

function normalizeVideoGenerationOutput(modelText, userText, previousPrompt = '') {
  const markerPrompt = modelText?.match(VIDEO_GEN_PATTERN)?.[1]?.trim();
  const currentPrompt = cleanVideoPrompt(markerPrompt || modelText || userText);
  const priorPrompt = cleanVideoPrompt(previousPrompt);
  const correctionText = cleanVideoPrompt(userText);

  let prompt = currentPrompt || priorPrompt || correctionText;
  if (priorPrompt && correctionText) {
    const sameAsPrevious = currentPrompt && cleanVideoPrompt(currentPrompt) === priorPrompt;
    if (!sameAsPrevious) {
      prompt = `${priorPrompt}, ${correctionText}`.replace(/\s+/g, ' ').trim();
    }
  }

  const fallback = 'A cinematic, high-quality short video based on the user request';
  return `[VIDEO_GEN: ${prompt || fallback}]`;
}

function extractImageGenerationPrompt(content = '') {
  const match = String(content || '').match(IMAGE_GEN_PATTERN);
  const prompt = cleanImagePrompt(match?.[1] || '');
  return prompt || '';
}

async function persistGeneratedImageAsset({ prompt, userId, conversationId, messageId, allowNsfw = false }) {
  const cleanPrompt = cleanImagePrompt(prompt);
  if (!cleanPrompt || !userId || !conversationId || !messageId) return null;

  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'persist-image',
      prompt: cleanPrompt,
      model: 'flux-realism',
      unsafe: Boolean(allowNsfw),
      userId,
      conversationId,
      messageId,
      width: 1280,
      height: 1280,
      seed: 1,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Persist image failed (${response.status}) ${text}`.trim());
  }

  const payload = await response.json();
  return payload?.image || null;
}

function getFileExtension(name = '') {
  return name.split('.').pop().toLowerCase();
}

function getDocumentLabel(name = '') {
  const ext = getFileExtension(name);
  if (ext === 'pdf') return 'PDF Document';
  if (ext === 'docx' || ext === 'doc') return 'Word Document';
  return 'File';
}

function cleanAttachmentText(text = '') {
  return String(text || '').replace(/\u0000/g, '').trim();
}

function formatAttachmentForPrompt(attachment, charLimit) {
  const label = getDocumentLabel(attachment.name);
  const fullText = cleanAttachmentText(attachment.text || attachment.parsedText || '');
  const body = fullText
    ? fullText.slice(0, charLimit)
    : `[No text could be extracted from this file${attachment.parseError ? `: ${attachment.parseError}` : ''}]`;
  const truncNote = fullText.length > charLimit
    ? `\n[...content truncated at ${charLimit} chars, total: ${fullText.length}]`
    : '';
  return `=== ${label}: "${attachment.name}" ===\n${body}${truncNote}\n=== End of "${attachment.name}" ===`;
}

function buildAttachmentPrompt(attachments, charLimit) {
  return attachments.map((attachment) => formatAttachmentForPrompt(attachment, charLimit)).join('\n\n');
}

function isExportRefusal(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;

  return (
    /(?:^|[\s\n])(i\s+(?:cannot|can't|won't|am unable|'?m unable)|sorry[,\s]+(?:i\s+)?(?:cannot|can't|won't|am unable))/i.test(normalized)
    && /\b(pdf|docx|pptx|downloadable|file|document)\b/i.test(normalized)
  ) || (
    /\b(cannot provide|can't provide|unable to provide|won't provide)\b/i.test(normalized)
    && /\b(pdf|docx|pptx|downloadable|file|document)\b/i.test(normalized)
  );
}

function getFallbackExportContent(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== 'assistant') continue;

    const cleaned = sanitizeDocumentContent(message.content || '');
    if (cleaned && cleaned.length > 80 && !isExportRefusal(cleaned)) {
      return cleaned;
    }
  }

  return '';
}

function cloneAttachmentsForResend(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return attachments.map((attachment) => ({ ...attachment }));
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          return part.text || part.content || part.value || '';
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object') {
    return content.text || content.content || content.value || JSON.stringify(content);
  }
  return String(content);
}

function describeGeneratedImageContent(content = '') {
  const markerPrompt = String(content || '').match(IMAGE_GEN_PATTERN)?.[1]?.trim();
  if (!markerPrompt) return '';
  const prompt = cleanImagePrompt(markerPrompt).slice(0, 700);
  return prompt
    ? `Generated an image from this prompt: "${prompt}".`
    : 'Generated an image in the previous assistant turn.';
}

function getLatestGeneratedImagePrompt(historySource = []) {
  const source = Array.isArray(historySource) ? historySource : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (message?.role !== 'assistant') continue;
    const text = normalizeMessageContent(message?.promptContent || message?.content || '');
    const markerPrompt = String(text || '').match(IMAGE_GEN_PATTERN)?.[1]?.trim();
    if (!markerPrompt) continue;
    const cleaned = cleanImagePrompt(markerPrompt);
    if (cleaned) return cleaned.slice(0, 900);
  }
  return '';
}

function getLatestGeneratedVideoPrompt(historySource = []) {
  const source = Array.isArray(historySource) ? historySource : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (message?.role !== 'assistant') continue;
    const text = normalizeMessageContent(message?.promptContent || message?.content || '');
    const markerPrompt = String(text || '').match(VIDEO_GEN_PATTERN)?.[1]?.trim();
    if (!markerPrompt) continue;
    const cleaned = cleanVideoPrompt(markerPrompt);
    if (cleaned) return cleaned.slice(0, 900);
  }
  return '';
}

function isImageRefinementFollowup(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;

  const dissatisfaction = /\b(not\s+as\s+expected|not\s+good|not\s+right|doesn'?t\s+look\s+right|wrong|bad|failed|issue|problem|fix|improve|adjust|refine|tweak|modify|redo|regenerate|retry|again|visible|show|closer|close[-\s]?up|angle|lighting|camera|detail)\b/i;
  const reference = /\b(this|that|it|image|pic|picture|render|generation|one|result|output|previous|last)\b/i;
  const shortFollowup = value.length <= 220;

  return shortFollowup && dissatisfaction.test(value) && reference.test(value);
}

function isVideoRefinementFollowup(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;

  const dissatisfaction = /\b(not\s+as\s+expected|not\s+good|not\s+right|doesn'?t\s+look\s+right|wrong|bad|failed|issue|problem|fix|improve|adjust|refine|tweak|modify|redo|regenerate|retry|again|visible|show|closer|camera|lighting|motion|scene|cut|shot|transition)\b/i;
  const reference = /\b(this|that|it|video|clip|render|generation|one|result|output|previous|last)\b/i;
  const shortFollowup = value.length <= 220;

  return shortFollowup && dissatisfaction.test(value) && reference.test(value);
}

function describeGeneratedVideoContent(content = '') {
  const markerPrompt = String(content || '').match(VIDEO_GEN_PATTERN)?.[1]?.trim();
  if (!markerPrompt) return '';
  const prompt = cleanVideoPrompt(markerPrompt).slice(0, 700);
  return prompt
    ? `Generated a video from this prompt: "${prompt}".`
    : 'Generated a video in the previous assistant turn.';
}

function formatHistoryMessageForModel(message, promptInterpretation) {
  let msgContent = normalizeMessageContent(message?.promptContent || message?.content);
  if (message?.role === 'assistant' && IMAGE_GEN_PATTERN.test(msgContent)) {
    const generatedSummary = describeGeneratedImageContent(msgContent);
    if (promptInterpretation.codeIntent) {
      return '[Previous assistant response generated an image. Current task is code; do not continue image generation.]';
    }
    return `[Previous assistant response: ${generatedSummary} Use this only as recent conversation context. Do not output [IMAGE_GEN] unless the current user asks for a new image.]`;
  }
  if (message?.role === 'assistant' && VIDEO_GEN_PATTERN.test(msgContent)) {
    const generatedSummary = describeGeneratedVideoContent(msgContent);
    if (promptInterpretation.codeIntent) {
      return '[Previous assistant response generated a video. Current task is code; do not continue video generation.]';
    }
    return `[Previous assistant response: ${generatedSummary} Use this only as recent conversation context. Do not output [VIDEO_GEN] unless the current user asks for a new video.]`;
  }
  return msgContent;
}

function formatRecentContextMessage(message) {
  const role = message?.role === 'assistant' ? 'MIRA' : 'User';
  let text = normalizeMessageContent(message?.promptContent || message?.content || '');
  if (message?.role === 'assistant' && IMAGE_GEN_PATTERN.test(text)) {
    text = describeGeneratedImageContent(text);
  } else if (message?.role === 'assistant' && VIDEO_GEN_PATTERN.test(text)) {
    text = describeGeneratedVideoContent(text);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (message?.media?.query) {
    text = `${text} Related media/search topic: ${message.media.query}.`.trim();
  }
  if (!text) return '';
  return `${role}: ${text.slice(0, 700)}`;
}

function buildRecentConversationContext(historySource = []) {
  const recent = (Array.isArray(historySource) ? historySource : [])
    .slice(-5)
    .map(formatRecentContextMessage)
    .filter(Boolean);
  if (!recent.length) return '';
  return recent.join('\n').slice(0, 1800);
}

function needsRecentConversationContext(text = '', historySource = []) {
  if (!Array.isArray(historySource) || historySource.length === 0) return false;
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (CONTEXT_REFERENCE_PATTERN.test(value)) return true;
  if (SHORT_CONTEXT_FOLLOWUP_PATTERN.test(value)) return true;
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  return wordCount <= 5 && /[?!]$/.test(value) && !/^\s*(hi|hello|hey|thanks|thank\s+you)\b/i.test(value);
}

function isSimpleGreeting(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  return wordCount <= 6 && SIMPLE_GREETING_PATTERN.test(value);
}

function buildModelHistory(historySource = [], promptInterpretation = {}, { isGreeting = false } = {}) {
  const recent = Array.isArray(historySource) ? historySource.slice() : [];
  const maxMessages = isGreeting ? MAX_GREETING_HISTORY_MESSAGES : MAX_HISTORY_MESSAGES_FOR_MODEL;
  const maxChars = isGreeting ? MAX_GREETING_HISTORY_CHARS : MAX_HISTORY_CHARS_FOR_MODEL;
  const selected = [];
  let totalChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    let msgContent = formatHistoryMessageForModel(message, promptInterpretation);
    if (message.role === 'user' && message.attachments?.length) {
      const fileAttachments = message.attachments.filter(a => !a.isImage && (a.parsedText || a.parseError));
      if (fileAttachments.length) {
        const injected = buildAttachmentPrompt(fileAttachments, HISTORY_ATTACHMENT_CHAR_LIMIT);
        msgContent = `${msgContent}\n\n[Previously attached file(s) — still in context]:\n\n${injected}`;
      }
    }

    if (!msgContent.trim()) continue;
    const nextChars = totalChars + msgContent.length;
    if (selected.length >= maxMessages || (selected.length > 0 && nextChars > maxChars)) break;

    selected.push({ role: message.role, content: msgContent });
    totalChars = nextChars;
  }

  return selected.reverse();
}

export default function useChat() {
  const { user } = useAuth();
  const profile = useUserProfile();
  const {
    chatConversations,
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    setIsSearching,
    setActiveResponseModel,
    activeProjectId,
    selectedModel,
  } = useChatContext();
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const abortRef = useRef(false);
  const lastStableAssistantByIdRef = useRef(new Map());
  // rAF-coalesced streaming state setters: every model token would otherwise
  // trigger a full React re-render (heavy with ReactMarkdown). Collapse all
  // updates within the same frame into one paint to keep typing buttery.
  const pendingStreamRef = useRef(null);
  const pendingThinkingRef = useRef(null);
  const streamRafRef = useRef(null);
  const thinkingRafRef = useRef(null);

  const flushStreamingContent = useCallback((value) => {
    if (abortRef.current) return;
    pendingStreamRef.current = value;
    if (streamRafRef.current != null) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    streamRafRef.current = schedule(() => {
      streamRafRef.current = null;
      const next = pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (next != null && !abortRef.current) setStreamingContent(next);
    });
  }, []);

  const flushThinkingContent = useCallback((value) => {
    if (abortRef.current) return;
    pendingThinkingRef.current = value;
    if (thinkingRafRef.current != null) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    thinkingRafRef.current = schedule(() => {
      thinkingRafRef.current = null;
      const next = pendingThinkingRef.current;
      pendingThinkingRef.current = null;
      if (next != null && !abortRef.current) setThinkingContent(next);
    });
  }, []);

  const cancelPendingStreamFlushes = useCallback(() => {
    const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    if (streamRafRef.current != null) { cancel(streamRafRef.current); streamRafRef.current = null; }
    if (thinkingRafRef.current != null) { cancel(thinkingRafRef.current); thinkingRafRef.current = null; }
    pendingStreamRef.current = null;
    pendingThinkingRef.current = null;
  }, []);

  const normalizeImageForUpload = useCallback(async (image) => {
    const raw = image.base64 || '';
    const sourceDataUrl = raw.startsWith('data:')
      ? raw
      : `data:${image.mimeType || image.type || 'image/jpeg'};base64,${raw}`;

    const initialBase64 = sourceDataUrl.split(',')[1] || '';
    if (initialBase64.length < 550_000) {
      return {
        base64: initialBase64,
        mimeType: image.mimeType || image.type || 'image/jpeg',
      };
    }

    const loaded = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = sourceDataUrl;
    });

    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(loaded.width, loaded.height));
    const targetW = Math.max(1, Math.round(loaded.width * scale));
    const targetH = Math.max(1, Math.round(loaded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        base64: initialBase64,
        mimeType: image.mimeType || image.type || 'image/jpeg',
      };
    }

    ctx.drawImage(loaded, 0, 0, targetW, targetH);
    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

    return {
      base64: compressedDataUrl.split(',')[1] || initialBase64,
      mimeType: 'image/jpeg',
    };
  }, []);

  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }

    const unsub = subscribeMessages(currentConversationId, (msgs) => {
      setMessages((previous) => {
        const previousById = new Map((previous || []).map((msg) => [msg.id, msg]));
        const next = (msgs || []).map((incoming) => {
          if (!incoming?.id) return incoming;
          const prev = previousById.get(incoming.id);
          const stable = lastStableAssistantByIdRef.current.get(incoming.id);
          const incomingContent = String(incoming.content || '');
          const isAssistant = incoming.role === 'assistant';

          if (isAssistant && incomingContent.trim()) {
            lastStableAssistantByIdRef.current.set(incoming.id, incomingContent);
          }

          // Realtime snapshots can briefly emit empty assistant content during
          // write propagation; keep the last stable finalized content.
          if (
            isAssistant
            && !incomingContent.trim()
            && !incoming.isStreaming
            && (stable || String(prev?.content || '').trim())
          ) {
            return {
              ...incoming,
              content: stable || prev.content,
            };
          }

          return incoming;
        });

        // Preserve local echoes that were rendered instantly on send, until
        // Firebase catches up with the persisted server message.
        const pendingLocalEchoes = (previous || []).filter((msg) => msg?.localEcho);
        if (!pendingLocalEchoes.length) return next;

        const incomingFingerprints = new Set(next.map((msg) => messageFingerprint(msg)));
        const unresolvedEchoes = pendingLocalEchoes.filter(
          (msg) => !incomingFingerprints.has(messageFingerprint(msg)),
        );

        if (!unresolvedEchoes.length) return next;
        return [...next, ...unresolvedEchoes];

      });
    });
    return unsub;
  }, [currentConversationId]);

  const stopGenerating = useCallback(() => {
    abortRef.current = true;
    stopChatGeneration();
    cancelPendingStreamFlushes();
    setIsGenerating(false);
    setIsSearching(false);
    setActiveResponseModel(null);
    setStreamingContent('');
    setThinkingContent('');
  }, [cancelPendingStreamFlushes, setActiveResponseModel, setIsGenerating, setIsSearching]);

  const pruneMessagesAfter = useCallback(async (convId, messageId, sourceMessages = messages) => {
    const index = sourceMessages.findIndex((message) => message.id === messageId);
    if (index === -1) return [];

    const trailing = sourceMessages.slice(index + 1);
    await Promise.all(trailing.map((message) => deleteMessage(convId, message.id)));
    return sourceMessages.slice(0, index);
  }, [messages]);

  const sendMessage = useCallback(
    async (content, attachments = [], webSearch = false, options = {}) => {
      if ((!content.trim() && attachments.length === 0) || isGenerating || !user) return;

      abortRef.current = false;
      cancelPendingStreamFlushes();
      setIsGenerating(true);
      setStreamingContent('');
      setThinkingContent('');

      let convId = currentConversationId;
      const replaceMessageId = options.replaceMessageId || null;

      const textAttachments = attachments.filter((a) => !a.isImage);
      const imageAttachments = attachments.filter((a) => a.isImage);

      let displayContent = content;
      const attachmentData = [];

      if (imageAttachments.length > 0) {
        for (const img of imageAttachments) {
          attachmentData.push({ name: img.name, type: img.type, isImage: true, base64: img.base64 });
        }
      }

      if (textAttachments.length > 0) {
        const fileList = textAttachments.map((a) => a.name).join(', ');
        displayContent = displayContent
          ? `${displayContent}\n\n[Attached: ${fileList}]`
          : `[Attached: ${fileList}]`;
        for (const att of textAttachments) {
          attachmentData.push({ name: att.name, type: att.type, isImage: false, parsedText: att.text || '', parseError: att.parseError || '' });
        }
      }

      if (replaceMessageId) {
        // Update edited message instantly in the local timeline while writes
        // propagate to Firebase, and prune locally-visible trailing branch.
        setMessages((prev) => {
          const index = prev.findIndex((msg) => msg.id === replaceMessageId);
          if (index === -1) return prev;
          const next = prev.slice(0, index + 1);
          const target = next[index];
          next[index] = {
            ...target,
            content: displayContent,
            type: 'text',
            ...(options.promptContent ? { promptContent: options.promptContent } : { promptContent: null }),
            ...(options.webPage ? { webPage: options.webPage } : { webPage: null }),
            ...(attachmentData.length > 0 ? { attachments: attachmentData } : { attachments: null }),
          };
          return next;
        });
      } else {
        // Show the newly-sent user message immediately without waiting for DB IO.
        const localEcho = {
          id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: displayContent,
          type: 'text',
          ...(options.promptContent ? { promptContent: options.promptContent } : {}),
          ...(options.webPage ? { webPage: options.webPage } : {}),
          ...(attachmentData.length > 0 ? { attachments: attachmentData } : {}),
          localEcho: true,
        };
        setMessages((prev) => [...prev, localEcho]);
      }

      const hasImages = imageAttachments.length > 0;
      const modelOverride = options.modelOverride || null;
      const guardedOverride = modelOverride;
      const forceLockedByPrompt = LOCKED_TRIGGER_PATTERN.test(String(content || ''));
      // Locked mode is absolute: once locked is selected (or explicitly triggered),
      // no downstream router/fallback can switch it back for this request.
      const effectiveSelectedModel = (selectedModel === 'locked' || guardedOverride === 'locked' || forceLockedByPrompt)
        ? 'locked'
        : (guardedOverride || selectedModel || 'auto');
      const engineResult = processQuery(content, hasImages, { selectedMode: effectiveSelectedModel });
      const promptInterpretation = engineResult.interpretation || {
        route: engineResult.classification.intent,
        codeIntent: engineResult.classification.intent === 'code',
        imageIntent: engineResult.classification.intent === 'image',
        videoIntent: engineResult.classification.intent === 'video',
      };
      let chosenModel = engineResult.model;
      if (effectiveSelectedModel === 'locked') {
        chosenModel = 'locked';
      }
      setActiveResponseModel(chosenModel || null);
      let wantsImageGeneration = promptInterpretation.imageIntent === true;
      let wantsVideoGeneration = promptInterpretation.videoIntent === true;
      const simpleGreeting = !hasImages && attachments.length === 0 && !replaceMessageId && isSimpleGreeting(content);
      const requestedDocumentFormat = (wantsImageGeneration || wantsVideoGeneration)
        ? null
        : detectDocumentRequest(content, textAttachments.length > 0);
      const shouldThink = !simpleGreeting && (
        promptInterpretation.codeIntent
        || hasImages
        || wantsImageGeneration
        || wantsVideoGeneration
        || requestedDocumentFormat != null
        || engineResult.classification.intent === 'math'
        || engineResult.classification.complexity === 'high'
      );
      let documentVisualImages = [];

      try {
        let isNewChat = false;
        if (!convId) {
          isNewChat = true;
          const conv = await createConversation(user.uid, 'New Chat');
          convId = conv.id;
          setCurrentConversationId(convId);
          if (activeProjectId) {
            await addConversationToProject(user.uid, activeProjectId, convId);
          }
        }

        let historySource = isNewChat ? [] : messages;
        if (replaceMessageId) {
          historySource = await pruneMessagesAfter(convId, replaceMessageId, historySource);
        }

        const previousImagePrompt = getLatestGeneratedImagePrompt(historySource);
        const previousVideoPrompt = getLatestGeneratedVideoPrompt(historySource);
        const wantsImageRefinementFollowup = (
          !wantsImageGeneration
          && !hasImages
          && !wantsVideoGeneration
          && Boolean(previousImagePrompt)
          && isImageRefinementFollowup(content)
        );
        const wantsVideoRefinementFollowup = (
          !wantsVideoGeneration
          && !hasImages
          && Boolean(previousVideoPrompt)
          && isVideoRefinementFollowup(content)
        );
        if (wantsImageRefinementFollowup) {
          wantsImageGeneration = true;
        }
        if (wantsVideoRefinementFollowup) {
          wantsVideoGeneration = true;
        }

        const history = buildModelHistory(historySource, promptInterpretation, { isGreeting: simpleGreeting });

        // ── Adaptive user context (token-efficient) ──
        // Cache profile locally so heuristic + future sessions can use it.
        cacheProfile(profile);
        const currentConversation = Array.isArray(chatConversations)
          ? chatConversations.find((c) => c?.id === convId)
          : null;
        const isFirstTurn = (historySource?.length || 0) === 0;
        const contextMode = decideContextMode(content, isFirstTurn);
        const learnedFactsBlock = buildLearnedFactsBlock();
        const adaptiveContext = buildAdaptiveContext({
          profile,
          conversation: currentConversation,
          messages: historySource,
          mode: contextMode,
          learnedFacts: learnedFactsBlock,
        });
        // Always prepend the Mira identity preamble. Without this the model
        // has no anchor and will treat a bare-noun prompt ("Algaetree?") as
        // an identity assignment.
        const userSystemPrompt = adaptiveContext
          ? `${MIRA_IDENTITY_PROMPT}\n\n${adaptiveContext}`
          : MIRA_IDENTITY_PROMPT;

        if (replaceMessageId) {
          await updateMessage(convId, replaceMessageId, {
            content: displayContent,
            type: 'text',
            ...(options.promptContent ? { promptContent: options.promptContent } : { promptContent: null }),
            ...(options.webPage ? { webPage: options.webPage } : { webPage: null }),
            ...(attachmentData.length > 0 ? { attachments: attachmentData } : { attachments: null }),
          });
        } else {
          await addMessage(convId, {
            role: 'user',
            content: displayContent,
            type: 'text',
            ...(options.promptContent ? { promptContent: options.promptContent } : {}),
            ...(options.webPage ? { webPage: options.webPage } : {}),
            ...(attachmentData.length > 0 ? { attachments: attachmentData } : {}),
          });
        }

        const assistantMsgId = await addMessage(convId, {
          role: 'assistant',
          content: '',
          type: 'text',
          modelUsed: chosenModel,
        });

        // ── Prompt enhancer / clarification gate ──
        // Before dispatching to the main model, ask a small/fast model to
        // either (a) rewrite the user's basic prompt into a richer end-to-end
        // prompt, or (b) ask a single clarifying question when a creation
        // request is missing critical info. Silent on "pass" / on failure.
        let enhancedContent = '';
        const previousAssistant = [...historySource].reverse().find((m) => m?.role === 'assistant');
        const followingClarification = Boolean(previousAssistant?.isClarification);
        const enhancerEligible = !followingClarification && !wantsImageRefinementFollowup && shouldRunEnhancer({
          content,
          interpretation: promptInterpretation,
          hasImages,
          hasAttachments: textAttachments.length > 0,
          isReplay: Boolean(replaceMessageId),
          isGreeting: simpleGreeting,
          isDocument: Boolean(requestedDocumentFormat),
        });
        if (enhancerEligible) {
          try {
            const decision = await assessAndRefinePrompt({ content, interpretation: promptInterpretation });
            if (!abortRef.current) {
              if (decision.action === 'clarify') {
                await updateMessage(convId, assistantMsgId, {
                  content: decision.question,
                  modelUsed: decision.model || 'mira',
                  isClarification: true,
                });
                if (isNewChat) {
                  generateSmartTitle(content, decision.question).then((title) => {
                    updateConversation(user.uid, convId, { title });
                  });
                }
                return;
              }
              if (decision.action === 'enhance' && decision.prompt) {
                enhancedContent = decision.prompt;
              }
            }
          } catch (enhancerErr) {
            console.warn('Prompt enhancer failed:', enhancerErr?.message);
          }
        }

        // Media (videos + images) fetched alongside the web search.
        // Attached to the assistant message for the UI gallery — NOT injected
        // into the LLM prompt (would bloat tokens and confuse the model).
        let mediaForMessage = null;
        let generatedMediaForMessage = null;
        let deterministicMediaReply = null;

        {
          let userContent = options.promptContent || enhancedContent || content;

          const wantsMediaGallery = isMediaRequest(content);
          const wantsOnlyMediaGallery = isMediaOnlyRequest(content);
          const shouldUseVisualAnchor = needsVisualSearchAnchor(content, hasImages);
          const shouldAttachContextualMedia = wantsContextualDeviceMedia(content);
          const textResearchMediaScope = buildTextResearchMediaScope(content);
          const shouldUseContextualSearch = needsContextualWebSearch(content, historySource);
          const recentContextAnchor = getRecentContextAnchor(historySource);
          const recentConversationContext = needsRecentConversationContext(content, historySource)
            ? buildRecentConversationContext(historySource)
            : '';
          const recentConversationContextBlock = recentConversationContext
            ? `\n\n=== RECENT CONVERSATION CONTEXT FOR THIS FOLLOW-UP ===\n${recentConversationContext}\n=== END RECENT CONVERSATION CONTEXT ===\n\nUse this context to resolve the current short follow-up before answering. If the previous turn generated an image, treat questions like "are you sure?" as referring to that generated image/prompt unless the user clearly changes topic.`
            : '';
          if (recentConversationContextBlock) {
            userContent = `${userContent}${recentConversationContextBlock}`;
          }
          // Auto-enable web search when an image question asks about a visible
          // person/product/object/device. The image analysis becomes the search
          // anchor, then the final answer uses live sources instead of stopping
          // at a vision-only guess.
          const effectiveWebSearch = !simpleGreeting && (webSearch || engineResult.needsSearch || shouldUseVisualAnchor || shouldUseContextualSearch || Boolean(textResearchMediaScope));
          let visualSearchAnchor = '';

          // Build a context-aware search query. Short follow-up questions like
          // "tell me more about this device" lose meaning without prior context,
          // so we anchor the query with proper-noun entities extracted from the
          // most recent assistant reply. Keep the query SHORT — search engines
          // (especially news RSS) return no results for long noisy queries.
          //
          // Strip greetings, fillers, and intent verbs so the engine sees only
          // the actual topic. Without this, prompts like
          // "Hello, please do some research about the algaetree?" were sent to
          // the search API verbatim and matched on "Hello" instead of the
          // intended subject.
          const cleanSearchTopic = (raw = '') => {
            let value = String(raw || '').trim();
            if (!value) return '';
            // Preserve quoted entities verbatim — they ARE the topic.
            const quoted = value.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
            if (quoted) return quoted[1].trim();
            // Drop trailing punctuation/question marks.
            value = value.replace(/[?!.]+\s*$/g, '').trim();
            // Strip leading greetings ("hi", "hello", "hey ...", "good morning") plus comma.
            value = value.replace(/^(?:hi|hello|hey(?:\s+there)?|yo|sup|good\s+(?:morning|afternoon|evening|day))[,!.\s]+/i, '').trim();
            // Strip polite leading fillers ("please", "kindly", "can you", "could you", "would you").
            value = value.replace(/^(?:please|kindly|can\s+you|could\s+you|would\s+you|will\s+you|may\s+you|pls)[,!.\s]+/i, '').trim();
            // Strip leading research/info intent verbs.
            const intentLead = /^(?:do\s+some\s+(?:research|digging)\s+(?:about|on|into|for)?|do\s+(?:some\s+)?(?:research|digging)|dig\s+(?:into|on|up)|digging\s+(?:into|on)|look\s+(?:into|up)|search\s+(?:for|about|on)?|investigate|research\s+(?:about|on|into|for)?|find\s+(?:me\s+)?(?:out\s+)?(?:info|information|details|more)?(?:\s+(?:about|on|for))?|tell\s+me\s+(?:something|more|anything|everything|a\s+bit|a\s+little)?\s*about|tell\s+me\s+about|give\s+me\s+(?:some\s+)?(?:info|information|details|background|context)\s+(?:about|on)|share\s+(?:some\s+)?(?:info|information|details)\s+(?:about|on)|learn\s+(?:more\s+)?about|teach\s+me\s+about|brief\s+me\s+on|walk\s+me\s+through|overview\s+of|info\s+(?:on|about)|details?\s+(?:on|about)|background\s+on|context\s+on|what(?:'s|\s+is|\s+are)|who(?:'s|\s+is|\s+are)|where\s+(?:is|are)|do\s+you\s+know(?:\s+(?:about|of))?|have\s+you\s+heard\s+of|ever\s+heard\s+of|familiar\s+with|any\s+idea\s+(?:what|who|where|about))[,!.:\s]+/i;
            for (let i = 0; i < 3; i += 1) {
              const next = value.replace(intentLead, '').trim();
              if (next === value) break;
              value = next;
            }
            // Drop trailing pleas/fillers ("please", "thanks", "thx").
            value = value.replace(/[,!.\s]+(?:please|kindly|thanks?|thank\s+you|thx|cheers)[?!.\s]*$/i, '').trim();
            // Strip leading articles.
            value = value.replace(/^(?:the|a|an)\s+/i, '').trim();
            // Strip leading prepositions left over after intent removal.
            value = value.replace(/^(?:about|on|into|for|regarding|concerning|of)\s+/i, '').trim();
            // Strip leading articles again if the preposition exposed one.
            value = value.replace(/^(?:the|a|an)\s+/i, '').trim();
            return value;
          };

          const buildContextualSearchQuery = (current) => {
            if (visualSearchAnchor) {
              return buildVisualSearchScope(visualSearchAnchor, current).query || visualSearchAnchor;
            }

            const cleaned = cleanSearchTopic(current);
            // If cleaning produced something short and topical, prefer it.
            const cleanedWords = cleaned.split(/\s+/).filter(Boolean);
            const useCleaned = cleaned && cleanedWords.length >= 1 && cleanedWords.length <= 12;

            const PRONOUN_RE = /\b(it|its|this|that|these|those|they|them|the (device|product|tool|item|object|thing|company|brand|manufacturer|maker|producer|person|model|app|software|platform|service|prototype|machine|system))\b/i;
            const looksReferential = current.length < 80 || PRONOUN_RE.test(current);
            const fallback = useCleaned ? cleaned : current;
            if (!looksReferential || historySource.length === 0) return fallback;

            const dedup = getRecentContextEntities(historySource).slice(0, 3);
            if (!dedup.length) return fallback;

            // Pull a couple of meaningful keywords from the current message
            // (skip stopwords and the pronouns we used to detect referentiality).
            const STOP_KW = new Set(['can','you','tell','me','more','about','this','that','the','a','an','is','are','was','were','do','does','did','what','how','why','when','where','please','it','its','they','them','these','those','of','to','for','on','in','with','and','or','but','know','let','hello','hi','hey','research','search','find','look','dig','digging','some','do']);
            const kw = (useCleaned ? cleaned : current).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
              .filter((w) => w.length > 2 && !STOP_KW.has(w))
              .slice(0, 2);

            // Final query: entities first (they carry the topic), then a couple
            // of keywords from the current question. Short and search-friendly.
            return [...dedup, ...kw].join(' ').trim() || fallback;
          };

          // Web search injection — skip when an explicit document export is requested,
          // so unrelated search results don't override the attached/previous file context.
          if (effectiveWebSearch && content.trim() && !requestedDocumentFormat) {
            setIsSearching(true);
            try {
              if (shouldUseVisualAnchor && imageAttachments[0]) {
                try {
                  const visual = await analyzeImage(
                    'Identify the most searchable entity in this image. Read visible text/OCR exactly. Return one concise web search query, max 12 words, with exact visible product/brand/device names first, then 1-3 descriptive keywords. If a label/sign contains a name, include that exact name. Do not answer the user, do not explain, and do not guess a person identity unless visible text or a highly recognizable public figure supports it.',
                    imageAttachments[0],
                    imageAttachments[0].mimeType || imageAttachments[0].type || 'image/jpeg',
                  );
                  visualSearchAnchor = cleanVisualSearchAnchor(visual?.result || '');
                } catch (visualErr) {
                  console.warn('Visual search anchor failed:', visualErr.message);
                }
              }
              let searchQuery = textResearchMediaScope?.query || buildContextualSearchQuery(content);
              // Only attach a related-media gallery when the user has actually
              // signalled they want media (explicit "videos/images/...", an
              // image attachment, or a "this device" follow-up). Plain
              // text-research questions like "what is X" / "tell me about X"
              // must NOT trigger an auto media gallery — search engines return
              // off-topic YouTube/image results for bare nouns and pollute the
              // reply with irrelevant embeds.
              const shouldAttachRelatedMedia = wantsMediaGallery || shouldUseVisualAnchor || shouldAttachContextualMedia;
              const includeMedia = shouldAttachRelatedMedia;
              const visualScope = visualSearchAnchor ? buildVisualSearchScope(visualSearchAnchor, content) : null;
              const searchPayload = { query: searchQuery, includeMedia };
              if (visualScope?.query) {
                searchPayload.anchor = visualScope.entity || visualSearchAnchor;
                searchPayload.mediaQuery = visualScope.mediaQuery || visualScope.query;
                searchPayload.strictAnchor = true;
              } else if (textResearchMediaScope?.query) {
                searchPayload.anchor = textResearchMediaScope.entity;
                searchPayload.mediaQuery = textResearchMediaScope.mediaQuery || textResearchMediaScope.query;
                searchPayload.strictAnchor = true;
              }
              let searchRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchPayload),
              });
              let searchData = await searchRes.json();
              const strictRetryQuery = visualScope?.mediaQuery || textResearchMediaScope?.mediaQuery || visualSearchAnchor;
              const strictRetryAnchor = visualScope?.entity || textResearchMediaScope?.entity || visualSearchAnchor;
              if ((!Array.isArray(searchData.results) || searchData.results.length === 0) && strictRetryQuery && searchQuery !== strictRetryQuery) {
                const retryRes = await fetch('/api/search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    query: strictRetryQuery,
                    includeMedia,
                    mediaQuery: strictRetryQuery,
                    anchor: strictRetryAnchor,
                    strictAnchor: true,
                  }),
                });
                const retryData = await retryRes.json();
                const retryHasResults = Array.isArray(retryData.results) && retryData.results.length > 0;
                const retryHasMedia = Array.isArray(retryData.media?.videos) && retryData.media.videos.length > 0
                  || Array.isArray(retryData.media?.images) && retryData.media.images.length > 0;
                if (retryHasResults || retryHasMedia) {
                  searchQuery = strictRetryQuery;
                  searchData = retryData;
                }
              }
              const mediaQueryForMessage = visualScope?.mediaQuery || textResearchMediaScope?.mediaQuery || searchQuery;
              const realVideos = Array.isArray(searchData.media?.videos) ? searchData.media.videos : [];
              const realImages = Array.isArray(searchData.media?.images) ? searchData.media.images : [];
              const mediaBlock = (() => {
                if (!shouldAttachRelatedMedia || (!realVideos.length && !realImages.length)) return '';
                const lines = [];
                if (realVideos.length) {
                  lines.push('Videos (auto-rendered as embeds below your reply):');
                  realVideos.slice(0, 6).forEach((v, i) => {
                    const platform = v.platform || 'web';
                    const title = (v.title || '').replace(/\s+/g, ' ').trim() || `${platform} video`;
                    lines.push(`  v${i + 1}. [${platform}] ${title} — ${v.url || v.embed || ''}`);
                  });
                }
                if (realImages.length) {
                  if (lines.length) lines.push('');
                  lines.push('Images (auto-rendered as thumbnails below your reply):');
                  realImages.slice(0, 6).forEach((im, i) => {
                    const title = (im.title || '').replace(/\s+/g, ' ').trim() || 'image';
                    lines.push(`  i${i + 1}. ${title} — ${im.url || ''}`);
                  });
                }
                return `\n\n=== REAL MEDIA GALLERY (already shown to the user as embeds/thumbnails under your reply) ===\n${lines.join('\n')}\n=== END MEDIA GALLERY ===`;
              })();
              if (wantsMediaGallery) {
                if (realVideos.length || realImages.length) {
                  mediaForMessage = { videos: realVideos, images: realImages, query: mediaQueryForMessage };
                  if (wantsOnlyMediaGallery) {
                    deterministicMediaReply = 'Here are the most relevant clips and photos I found — open any item in the gallery below to play or preview it here.';
                  }
                } else if (wantsOnlyMediaGallery) {
                  deterministicMediaReply = "I couldn't find relevant embeddable media for this search this time.";
                }
              }
              if (!wantsMediaGallery && shouldUseVisualAnchor && (realVideos.length || realImages.length)) {
                mediaForMessage = { videos: realVideos, images: realImages, query: mediaQueryForMessage };
              }
              if (searchData.results?.length) {
                const snippets = searchData.results
                  .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                const contextBlock = recentContextAnchor
                  ? `\nConversation context anchor from previous turns: "${recentContextAnchor}"`
                  : '';
                userContent = `${content}${recentConversationContextBlock}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${new Date().toUTCString()}) ===\nSearch query used: "${searchQuery}"${contextBlock}\n\n${snippets}\n=== END SEARCH DATA ===${mediaBlock}\n\nUSAGE RULES:\n- These results are LIVE data fetched right now from the internet — your training cutoff does NOT apply here.\n- Conversation context comes FIRST. Resolve pronouns and phrases like "this device", "that product", "it", or "the company" from the conversation context anchor before interpreting search results.\n- If the search results clearly do not match the entity the user is referring to in this conversation, IGNORE the search results and answer from prior turns / your own knowledge instead. Do NOT pivot to an unrelated topic just because it appeared in the search results.\n- If the user asks who makes, produces, owns, founded, launched, or sells the referenced thing, search results are required evidence. Do not say you need more details when the context anchor already names the referenced thing.\n- When the results are on-topic, cite the sources by their [number].\n- MEDIA RULES (strict, NON-NEGOTIABLE):\n   • NEVER write or paste any YouTube, Instagram, Twitter/X, TikTok, or article URL as text or as a markdown link in your reply. The user has already had real links/embeds rendered for them by the UI (see the MEDIA GALLERY block above and the [number] citations).\n   • NEVER invent video titles, image descriptions, durations, channel names, view counts, or URLs. If you do not have a verified value, omit it.\n   • The UI auto-renders an embedded video player + image gallery directly under your reply for every item in the MEDIA GALLERY block. Do NOT enumerate them.\n   • When the user asks for "videos", "images", "more media", "social posts", or similar, reply with ONE short sentence pointing at the gallery (e.g. "Here are the most relevant clips and photos I found — see the gallery below.") and stop.\n   • If the MEDIA GALLERY block is empty, say plainly that you couldn't find relevant media this time. Do NOT invent placeholder links to fill the gap.\n\nAnswer:`;
                if (!wantsOnlyMediaGallery && shouldAttachRelatedMedia) {
                  userContent = userContent.replace(
                    '   • When the user asks for "videos", "images", "more media", "social posts", or similar, reply with ONE short sentence pointing at the gallery (e.g. "Here are the most relevant clips and photos I found — see the gallery below.") and stop.',
                    '   • If the user asks a substantive question (details, explanation, identity, research, comparison, features, latest info, etc.), answer that question first using the web results and citations. Treat the media gallery as complementary supporting material, not the whole answer. Only media-only requests should get a one-sentence gallery pointer.'
                  );
                  userContent += '\n\nADDITIONAL MEDIA GUIDANCE: Answer the user\'s actual question with researched details and citations first. If related media is available, treat it only as a complementary gallery below the answer; do not replace the answer with a media-only sentence.';
                }
              } else {
                const contextNote = recentContextAnchor
                  ? `\nConversation context anchor from previous turns: "${recentContextAnchor}"`
                  : '';
                userContent = `${content}${recentConversationContextBlock}\n\n[Web search returned no results.${mediaBlock ? ' A related media gallery is rendered below; reference it briefly without inventing links.' : ' Answer from conversation context and your knowledge; note your cutoff date if relevant.'}]${contextNote}${mediaBlock}`;
              }
              if (visualSearchAnchor) {
                userContent = userContent
                  .replace(`Search query used: "${searchQuery}"`, `Search query used: "${searchQuery}"\nImage-derived search anchor: "${visualSearchAnchor}"`)
                  .replace('- When the results are on-topic, cite the sources by their [number].', '- For image identity / object matching, only identify a person, product, place, or device when the source title/snippet clearly matches visible text, logo, distinctive object details, or the image-derived anchor. If the match is weak, say you could not verify it from the web results.\n- When the results are on-topic, cite the sources by their [number].');
              }
              if (realVideos.length || realImages.length) {
                if (shouldAttachRelatedMedia) mediaForMessage = { videos: realVideos, images: realImages, query: mediaQueryForMessage };
              }
            } catch (e) {
              console.warn('Web search failed:', e.message);
            } finally {
              setIsSearching(false);
            }
          }

          if (textAttachments.length > 0) {
            const fileContents = buildAttachmentPrompt(textAttachments, CURRENT_ATTACHMENT_CHAR_LIMIT);
            userContent = userContent
              ? `${userContent}\n\nIMPORTANT: The uploaded file content is included below as plain text. Read it and answer the user's request directly from this content. If the user asks to analyze, summarize, or break down the document, do that now.\n\n${fileContents}`
              : `Please analyze the following file(s):\n\n${fileContents}`;
          }

          if (requestedDocumentFormat) {
            const priorFileNames = historySource
              .flatMap((m) => (m.role === 'user' && Array.isArray(m.attachments)) ? m.attachments : [])
              .filter((a) => a && !a.isImage && (a.parsedText || a.parseError))
              .map((a) => a.name)
              .filter(Boolean);
            const currentFileNames = textAttachments.map((a) => a.name).filter(Boolean);
            const sourceFiles = [...new Set([...currentFileNames, ...priorFileNames])];
            const sourceHint = sourceFiles.length
              ? ` The document must be built strictly from the uploaded file(s) already in this conversation: ${sourceFiles.join(', ')}. Do not introduce unrelated topics, web search snippets, or invented references.`
              : '';
            if (!sourceFiles.length) {
              const documentVisualScope = buildDocumentVisualScope(content);
              documentVisualImages = await fetchDocumentVisualImages(documentVisualScope);
            }
            const verifiedImageBlock = documentVisualImages.length
              ? `\n\nAVAILABLE VERIFIED DOCUMENT IMAGES (use only these exact image lines if you include real images):\n${documentVisualImages.map((image, index) => imageMarkdownLine(image, index)).filter(Boolean).join('\n')}`
              : '\n\nNo verified image URLs are available for this document request. Use mermaid diagrams for visuals; do not write image markdown.';
            userContent = `${userContent}\n\nDOCUMENT EXPORT REQUEST: Create the complete ${requestedDocumentFormat.toUpperCase()} document content now.${sourceHint} Return only the final document body in markdown. Start with the actual document title only. Do not add any conversational intro, fake download button, fake URL, placeholder link, page marker, image placeholder, download instruction, or note about markdown. Ignore any unrelated prior search results. Never include data:image, base64, generated data URL, placeholder, or invented image URLs.${verifiedImageBlock}`;
          }

          if (wantsImageGeneration) {
            const previousPromptContext = wantsImageRefinementFollowup && previousImagePrompt
              ? `\n\nPREVIOUS GENERATED IMAGE PROMPT (use as base context): "${previousImagePrompt}".\nThe current user message is a refinement request for that image. Keep the core subject, then apply only the user's requested corrections.`
              : '';
            userContent = `${userContent}${previousPromptContext}\n\nIMAGE GENERATION REQUEST: Return exactly one line in the form [IMAGE_GEN: ...]. Do not add any explanation, commentary, markdown, or extra text. The prompt inside the marker should be concise, detailed, and ready for image generation.`;
          }

          if (wantsVideoGeneration) {
            const previousVideoPromptContext = wantsVideoRefinementFollowup && previousVideoPrompt
              ? `\n\nPREVIOUS GENERATED VIDEO PROMPT (use as base context): "${previousVideoPrompt}".\nThe current user message is a refinement request for that video. Keep the core scene, then apply only the user's requested corrections.`
              : '';
            userContent = `${userContent}${previousVideoPromptContext}\n\nVIDEO GENERATION REQUEST: Return exactly one line in the form [VIDEO_GEN: ...]. Do not add any explanation, commentary, markdown, or extra text. The prompt inside the marker should be concise, cinematic, and ready for video generation.`;
          }

          if (hasImages && !wantsImageGeneration && !wantsVideoGeneration) {
            userContent = `${userContent}\n\nIMAGE ATTACHMENT NOTE: This current user message includes ${imageAttachments.length} actual image attachment${imageAttachments.length === 1 ? '' : 's'}. You can inspect the image input directly. Do NOT say the image is not visible, not accessible, only text-based, or that you cannot analyze it. Answer from the visible image and use any provided web-search data as supporting evidence.`;
          }

          if (deterministicMediaReply) {
            await updateMessage(convId, assistantMsgId, {
              content: deterministicMediaReply,
              modelUsed: 'search',
              ...(mediaForMessage ? { media: mediaForMessage } : {}),
            });
            if (isNewChat) {
              generateSmartTitle(content, deterministicMediaReply).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
            return;
          }

          history.push({ role: 'user', content: userContent });

          const images = [];
          for (const img of imageAttachments) {
            images.push(await normalizeImageForUpload(img));
          }

          let fullText = '';
          let requestFailed = false;
          let requestAborted = false;
          let responseModelUsed = chosenModel;

          const applyModelUsed = (nextModel) => {
            const normalized = String(nextModel || '').trim();
            if (!normalized) return;
            if (normalized === responseModelUsed) return;
            responseModelUsed = normalized;
            setActiveResponseModel(normalized);
            setMessages((prev) => prev.map((msg) => (
              msg.id === assistantMsgId ? { ...msg, modelUsed: normalized } : msg
            )));
          };

          // ── Response cache check ──
          const cacheKey = makeCacheKey({
            messages: history,
            model: chosenModel,
            systemPrompt: userSystemPrompt,
            images,
          });
          const cached = cacheKey ? getCachedResponse(cacheKey) : null;
          if (cached && !abortRef.current) {
            fullText = cached;
            setStreamingContent(cached);
            setIsSearching(false);
          } else {
          try {
            let firstChunkSeen = false;
            await sendChatMessage(
              history,
              chosenModel,
              (accumulated) => {
                if (abortRef.current) return;
                if (!firstChunkSeen && accumulated) { firstChunkSeen = true; setIsSearching(false); }
                fullText = accumulated;
                flushStreamingContent(accumulated);
              },
              images,
              {
                think: shouldThink,
                ...(userSystemPrompt ? { systemPrompt: userSystemPrompt } : {}),
                onModelUsed: applyModelUsed,
                onThinking: (accumulated) => {
                  if (abortRef.current) return;
                  if (!firstChunkSeen && accumulated) { firstChunkSeen = true; setIsSearching(false); }
                  flushThinkingContent(accumulated);
                },
              },
            );
          } catch (err) {
            if (err?.name === 'AbortError') {
              requestAborted = true;
            } else {
              requestFailed = true;
              fullText = fullText || `Sorry, something went wrong: ${err.message}`;
            }
          }
          // Cache successful responses
          if (cacheKey && fullText && !requestFailed && !requestAborted) {
            setCachedResponse(cacheKey, fullText);
          }
          }

          if (requestAborted || abortRef.current) {
            return;
          }

          if (wantsImageGeneration && !requestFailed) {
            fullText = normalizeImageGenerationOutput(fullText, content, wantsImageRefinementFollowup ? previousImagePrompt : '');
            const imagePrompt = extractImageGenerationPrompt(fullText);
            if (imagePrompt && !abortRef.current) {
              try {
                const persistedImage = await persistGeneratedImageAsset({
                  prompt: imagePrompt,
                  userId: user.uid,
                  conversationId: convId,
                  messageId: assistantMsgId,
                  allowNsfw: chosenModel === 'locked',
                });
                if (persistedImage?.url) {
                  generatedMediaForMessage = { images: [persistedImage] };
                }
              } catch (persistErr) {
                console.warn('Generated image persistence failed:', persistErr?.message);
              }
            }
          } else if (wantsVideoGeneration && !requestFailed) {
            fullText = normalizeVideoGenerationOutput(fullText, content, wantsVideoRefinementFollowup ? previousVideoPrompt : '');
          }

          // ── Model-driven fallback web search ──
          // If MIRA answered that it lacks current/factual knowledge AND we did
          // not already search the web, automatically run a web search and
          // regenerate a grounded answer. This is what lets MIRA resort to the
          // internet on its own when it is unable to answer — not only when the
          // user toggles web access on.
          const autoSearchEligible =
            !requestFailed &&
            !abortRef.current &&
            !effectiveWebSearch &&
            !wantsImageGeneration &&
            !wantsVideoGeneration &&
            !requestedDocumentFormat &&
            !hasImages &&
            content.trim().length > 0 &&
            indicatesKnowledgeGap(fullText);

          if (autoSearchEligible) {
            setIsSearching(true);
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            try {
              const fallbackQuery = buildContextualSearchQuery(content);
              const fallbackRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: fallbackQuery, includeMedia: false }),
              });
              const fallbackData = await fallbackRes.json();
              const fallbackResults = Array.isArray(fallbackData.results) ? fallbackData.results : [];

              if (fallbackResults.length && !abortRef.current) {
                const snippets = fallbackResults
                  .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                const groundedUserContent = `${content}${recentConversationContextBlock}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${new Date().toUTCString()}) ===\nSearch query used: "${fallbackQuery}"\n\n${snippets}\n=== END SEARCH DATA ===\n\nUSAGE RULES:\n- These results are LIVE data fetched right now from the internet — your training cutoff does NOT apply here.\n- You previously could not answer this from your own knowledge; now answer the user's question directly using these results.\n- Cite the sources you use by their [number].\n- Do not repeat that you lack current information — you now have it above.\n- Never invent URLs, citations, numbers, or facts beyond these results. If the results still do not cover it, say what is missing.`;
                history[history.length - 1] = { role: 'user', content: groundedUserContent };

                let retryText = '';
                let retryFirstChunkSeen = false;
                try {
                  await sendChatMessage(
                    history,
                    chosenModel,
                    (accumulated) => {
                      if (abortRef.current) return;
                      if (!retryFirstChunkSeen && accumulated) { retryFirstChunkSeen = true; setIsSearching(false); }
                      retryText = accumulated;
                      flushStreamingContent(accumulated);
                    },
                    images,
                    {
                      think: shouldThink,
                      ...(userSystemPrompt ? { systemPrompt: userSystemPrompt } : {}),
                      onModelUsed: applyModelUsed,
                      onThinking: (accumulated) => {
                        if (abortRef.current) return;
                        if (!retryFirstChunkSeen && accumulated) { retryFirstChunkSeen = true; setIsSearching(false); }
                        flushThinkingContent(accumulated);
                      },
                    },
                  );
                } catch (retryErr) {
                  console.warn('Auto web-search retry failed:', retryErr?.message);
                  retryText = '';
                }

                if (retryText && retryText.trim() && !abortRef.current) {
                  fullText = retryText;
                }
              }
            } catch (autoErr) {
              console.warn('Auto fallback web search failed:', autoErr?.message);
            } finally {
              setIsSearching(false);
            }
          }

          if (fullText) {
            // Strip + persist [REMEMBER: key=value] markers before display
            fullText = processRememberMarkers(fullText);
            fullText = sanitizeMemoryLeakStyleResponse(fullText);

            const requestedFormat = requestedDocumentFormat;
            let titleSource = fullText;
            if (requestedFormat) {
              const sanitizedContent = ensureVerifiedDocumentImages(sanitizeDocumentContent(fullText), documentVisualImages);
              const fallbackContent = getFallbackExportContent(historySource);
              const documentContent = isExportRefusal(sanitizedContent)
                ? fallbackContent || sanitizedContent
                : sanitizedContent;
              titleSource = documentContent;
              const documentUpdate = {
                content: documentContent,
                modelUsed: responseModelUsed || chosenModel,
                exportFormat: requestedFormat,
                exportStatus: 'ready',
              };
              try {
                const filename = `mira-${requestedFormat}-${Date.now()}.${requestedFormat}`;
                await exportDocument(documentContent, requestedFormat, filename);
              } catch (exportErr) {
                documentUpdate.exportStatus = 'failed';
                documentUpdate.exportError = exportErr?.message || 'Export failed';
              }
              await updateMessage(convId, assistantMsgId, documentUpdate);
              setMessages((prev) => prev.map((msg) => (
                msg.id === assistantMsgId ? { ...msg, ...documentUpdate } : msg
              )));
            } else {
              const assistantUpdate = {
                content: fullText,
                modelUsed: responseModelUsed || chosenModel,
                ...(mediaForMessage ? { media: mediaForMessage } : {}),
                ...(generatedMediaForMessage ? { generatedMedia: generatedMediaForMessage } : {}),
              };
              await updateMessage(convId, assistantMsgId, assistantUpdate);
              setMessages((prev) => prev.map((msg) => (
                msg.id === assistantMsgId ? { ...msg, ...assistantUpdate } : msg
              )));
            }

            if (isNewChat) {
              generateSmartTitle(content, titleSource).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
          }
        }
      } catch (err) {
        console.error('Send message error:', err);
      } finally {
        cancelPendingStreamFlushes();
        setIsGenerating(false);
        setIsSearching(false);
        setActiveResponseModel(null);
        setStreamingContent('');
        setThinkingContent('');
      }
    },
    [
      currentConversationId,
      isGenerating,
      messages,
      user,
      setCurrentConversationId,
      setIsGenerating,
      setIsSearching,
      setActiveResponseModel,
      activeProjectId,
      selectedModel,
      normalizeImageForUpload,
      pruneMessagesAfter,
    ]
  );

  const retryMessage = useCallback(async (message, webSearch = false) => {
    if (!message?.id || message.role !== 'user') return;
    stopGenerating();
    await sendMessage(message.content || '', cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
      ...(message.promptContent ? { promptContent: message.promptContent } : {}),
      ...(message.webPage ? { webPage: message.webPage } : {}),
    });
  }, [sendMessage, stopGenerating]);

  const editMessage = useCallback(async (message, nextContent, webSearch = false, modelOverride = null) => {
    if (!message?.id || message.role !== 'user') return;
    const content = String(nextContent || '').trim();
    if (!content) return;

    stopGenerating();
    await sendMessage(content, cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
      ...(modelOverride ? { modelOverride } : {}),
    });
  }, [sendMessage, stopGenerating]);

  return {
    messages,
    streamingContent,
    thinkingContent,
    sendMessage,
    stopGenerating,
    isGenerating,
    retryMessage,
    editMessage,
  };
}

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  installGenerationExitCancellation,
  sendChatMessage,
  stopChatGeneration,
} from '../services/api';
import {
  analyzeImage,
  buildVisionAnalysisPrompt,
  extractVisionSearchAnchor,
} from '../services/imageAnalysis.js';
import { needsFreshInformation, processQuery, shouldUseModelThinking } from '../services/engine';
import { assessAndRefinePrompt, shouldRunEnhancer } from '../services/promptEnhancer';
import {
  createConversation,
  addMessage,
  updateMessage,
  deleteMessage,
  updateConversation,
  updateConversationTitle,
  addConversationToProject,
  updateProjectConversation,
  enqueueConversationPrompt,
  acquireConversationRun,
  releaseConversationRun,
  subscribeMessages,
  getProjectContext,
  saveProjectContextTurn,
} from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useChatContext } from '../contexts/ChatContext';
import useUserProfile from './useUserProfile';
import { generateSmartTitle, generateConversationTitle, buildAdaptiveContext } from '../utils/helpers';
import {
  cacheProfile,
  decideContextMode,
  buildLearnedFactsBlock,
  buildResponsePreferencesBlock,
  learnResponsePreferences,
  processRememberMarkers,
  sanitizeMemoryLeakStyleResponse,
} from '../services/knowledgeBank';
import { makeCacheKey, getCachedResponse, setCachedResponse } from '../services/responseCache';
import {
  extractWebSearchRequest,
  isPotentialWebSearchControl,
  stripWebSearchControl,
} from '../services/webSearchControl';
import { buildEvidenceFallbackAnswer, searchWeb } from '../services/webSearch';
import { expandCompoundWords } from '../services/searchRelevance.js';
import { formSearchQuery } from '../services/searchQuery';
import {
  extractBrowserRequest,
  isPotentialBrowserControl,
  stripBrowserControl,
} from '../services/browserControl';
import {
  formatBrowserDocumentation,
  requestBrowserDocumentation,
} from '../services/mcpBrowser';
import {
  detectWebsiteInspectionRequest,
  extractToolCall,
  isPotentialToolControl,
  stripToolControl,
  TOOL_NAMES,
  toLegacyBrowserRequest,
} from '../services/toolControl';
import { executeHostTool } from '../services/toolExecutor';
import {
  assessResponseQuality,
  buildQualityCorrectionPrompt,
  humanizeAssistantText,
  polishAssistantAnswer,
} from '../services/responseQuality';
import { detectDocumentRequest, exportDocument, sanitizeDocumentContent } from '../utils/documentExport';
import { diagnosticLog, diagnosticWarn } from '../services/diagnostics.js';
import { buildSearchToolGuidance, decideRetrievalPolicy } from '../services/retrievalPolicy.js';
import {
  cleanImagePrompt,
  imagePromptSeed,
  normalizeImageGenerationOutput,
} from '../services/imagePrompt.js';
import {
  buildGreetingResponse,
  getPreviousGeneratedImageContext,
  getMostRecentAssistantMessage,
  isPreviousImageEditRequest,
  isSimpleGreeting,
} from '../services/contextPolicy.js';
import { selectModelTools } from '../services/modelTools.js';
import {
  AGENT_CAPABILITIES,
  classifyDesktopWorkspaceRequest,
  extractWorkspaceFileReferences,
  getAgentRuntimeCapabilities,
} from '../services/agentCapabilities.js';
import {
  agentTaskRequiresResearch,
  extractAgentTaskFallback,
  runAgentTask,
  shouldRunAgentTask,
} from '../services/agentTask.js';
import { isChatTimeoutError } from '../services/chatRequestPolicy.js';
import { buildProjectContextPrompt, buildProjectContextTurn } from '../services/projectContext.js';
import { createThrottledRealtimeWriter } from '../services/realtimeSync.js';
import {
  appendDesktopWorkspaceTurn,
  getDesktopWorkspaceMemory,
} from '../services/desktopBridge.js';
import {
  buildWorkspaceHistoryMessages,
  buildWorkspaceMemoryPrompt,
  mergeWorkspaceHistoryMessages,
} from '../services/workspaceMemory.js';
import {
  buildLocalWorkspaceSummary,
  requestWorkspaceSynthesis,
} from '../services/workspaceSynthesis.js';
import {
  buildDesktopWorkflowSteps,
  buildRegressionValidationCalls,
  desktopGoalNeedsMoreWork,
  desktopWorkflowStageForTool,
} from '../services/desktopAgentPolicy.js';

const CURRENT_ATTACHMENT_CHAR_LIMIT = 60000;
const MAX_DESKTOP_AGENT_ROUNDS = 32;
const MAX_DESKTOP_AGENT_REMINDERS = 4;
const MAX_DESKTOP_TOOL_RESULT_CHARS = 16000;

const DESKTOP_TOOL_NAMES = new Set([
  AGENT_CAPABILITIES.FILE_READ,
  AGENT_CAPABILITIES.FILE_LIST,
  AGENT_CAPABILITIES.FILE_WRITE,
  AGENT_CAPABILITIES.FILE_REPLACE,
  AGENT_CAPABILITIES.FILE_SEARCH,
  AGENT_CAPABILITIES.WORKSPACE_INDEX,
  AGENT_CAPABILITIES.WORKSPACE_SEARCH,
  AGENT_CAPABILITIES.WORKSPACE_VALIDATE,
  AGENT_CAPABILITIES.WORKSPACE_START,
  AGENT_CAPABILITIES.SHELL_RUN,
  AGENT_CAPABILITIES.TEST_RUN,
  AGENT_CAPABILITIES.GIT_STATUS,
  AGENT_CAPABILITIES.GIT_DIFF,
  AGENT_CAPABILITIES.GIT_INFO,
  AGENT_CAPABILITIES.GIT_PULL,
  AGENT_CAPABILITIES.GIT_PUSH,
  AGENT_CAPABILITIES.GIT_COMMIT,
  AGENT_CAPABILITIES.GIT_REMOTE_SET,
  AGENT_CAPABILITIES.CHANGE_LIST,
  AGENT_CAPABILITIES.CHANGE_UNDO,
  AGENT_CAPABILITIES.CHANGE_REDO,
]);

function desktopToolTitle(call = {}) {
  const path = String(call.arguments?.path || '').trim();
  return ({
    [AGENT_CAPABILITIES.FILE_LIST]: path ? `Inspect ${path}` : 'Inspect workspace',
    [AGENT_CAPABILITIES.FILE_READ]: path ? `Read ${path}` : 'Read source file',
    [AGENT_CAPABILITIES.FILE_SEARCH]: 'Search source code',
    [AGENT_CAPABILITIES.WORKSPACE_INDEX]: 'Build local code index',
    [AGENT_CAPABILITIES.WORKSPACE_SEARCH]: 'Search local code index',
    [AGENT_CAPABILITIES.WORKSPACE_VALIDATE]: 'Run regression suite',
    [AGENT_CAPABILITIES.WORKSPACE_START]: 'Start development server',
    [AGENT_CAPABILITIES.FILE_WRITE]: path ? `Apply ${path}` : 'Apply file change',
    [AGENT_CAPABILITIES.FILE_REPLACE]: path ? `Patch ${path}` : 'Patch source file',
    [AGENT_CAPABILITIES.SHELL_RUN]: 'Run workspace command',
    [AGENT_CAPABILITIES.TEST_RUN]: 'Run validation',
    [AGENT_CAPABILITIES.GIT_STATUS]: 'Check working tree',
    [AGENT_CAPABILITIES.GIT_DIFF]: 'Review applied diff',
    [AGENT_CAPABILITIES.GIT_INFO]: 'Inspect Git connection',
    [AGENT_CAPABILITIES.GIT_PULL]: 'Pull Git changes',
    [AGENT_CAPABILITIES.GIT_PUSH]: 'Push Git changes',
    [AGENT_CAPABILITIES.GIT_COMMIT]: 'Commit workspace changes',
    [AGENT_CAPABILITIES.GIT_REMOTE_SET]: 'Connect GitHub repository',
    [AGENT_CAPABILITIES.CHANGE_LIST]: 'Review MIRA changes',
    [AGENT_CAPABILITIES.CHANGE_UNDO]: 'Undo MIRA change',
    [AGENT_CAPABILITIES.CHANGE_REDO]: 'Redo MIRA change',
  })[call.name] || 'Work on workspace';
}

function compactActivityLines(value = '', prefix = '', limit = 5) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => `${prefix}${line.slice(0, 220)}`);
}

function boundedChangeLines(value = '', limit = 80) {
  const lines = String(value || '').split('\n').slice(0, limit).map((line) => line.slice(0, 500));
  return lines.join('\n').slice(0, 12_000).split('\n');
}

function desktopChangeSummary(call = {}, result = '') {
  if (![AGENT_CAPABILITIES.FILE_WRITE, AGENT_CAPABILITIES.FILE_REPLACE].includes(call.name)) return null;
  let payload = {};
  try { payload = JSON.parse(String(result || '{}')); } catch {}
  if (!payload.changeId || !payload.path) return null;
  const args = call.arguments || {};
  return {
    id: payload.changeId,
    path: payload.path,
    additions: Array.isArray(payload.additions)
      ? payload.additions.map((line) => String(line).slice(0, 500))
      : boundedChangeLines(call.name === AGENT_CAPABILITIES.FILE_WRITE ? args.content : args.newText),
    removals: Array.isArray(payload.removals)
      ? payload.removals.map((line) => String(line).slice(0, 500))
      : call.name === AGENT_CAPABILITIES.FILE_REPLACE ? boundedChangeLines(args.oldText) : [],
  };
}

function desktopToolActivity(call = {}, status = 'running', result = '') {
  const title = desktopToolTitle(call);
  const marker = status === 'error' ? '✕' : status === 'done' ? '✓' : '•';
  const lines = [`${marker} ${status === 'running' ? `${title}…` : title}`];
  const args = call.arguments || {};

  if (status === 'done' && [AGENT_CAPABILITIES.FILE_REPLACE, AGENT_CAPABILITIES.FILE_WRITE].includes(call.name)) {
    let payload = {};
    try { payload = JSON.parse(String(result || '{}')); } catch {}
    const removals = Array.isArray(payload.removals) ? payload.removals.join('\n') : args.oldText;
    const additions = Array.isArray(payload.additions)
      ? payload.additions.join('\n')
      : call.name === AGENT_CAPABILITIES.FILE_WRITE ? args.content : args.newText;
    lines.push(...compactActivityLines(removals, '  - '));
    lines.push(...compactActivityLines(additions, '  + '));
  } else if (status === 'running' && [AGENT_CAPABILITIES.SHELL_RUN, AGENT_CAPABILITIES.TEST_RUN].includes(call.name)) {
    const command = [args.command, ...(Array.isArray(args.args) ? args.args : [])].filter(Boolean).join(' ');
    if (command) lines.push(`  $ ${command.slice(0, 300)}`);
  } else if (status === 'error') {
    const message = String(result || 'The operation failed.').replace(/\s+/g, ' ').trim();
    lines.push(`  ${message.slice(0, 320)}`);
  }

  return lines.join('\n');
}

function stripAllControlText(text = '') {
  return stripToolControl(stripBrowserControl(stripWebSearchControl(text)));
}

function isToolNarration(text = '') {
  return /\b(?:let me|i(?:'ll|\s+will)|checking|searching|browsing|looking\s+up)\b[\s\S]{0,100}\b(?:search|check|verify|browse|internet|web|tool)\b/i
    .test(String(text || ''));
}

function applyTaskWorkflowPhase(workflow, update = {}) {
  if (!workflow) return workflow;
  const next = { ...workflow, updatedAt: Date.now() };
  if (update.phase === 'planning') return { ...next, phase: 'planning', status: 'running' };
  if (update.phase === 'planned') {
    return {
      ...next,
      phase: 'executing',
      steps: (update.steps || []).map((step, index) => ({
        id: step.id ?? index,
        title: String(step.title || `Step ${index + 1}`),
        instruction: String(step.instruction || ''),
        status: 'pending',
        result: '',
      })),
    };
  }
  if (update.phase === 'executing') {
    const activeIndex = Math.max(0, Number(update.step || 1) - 1);
    return {
      ...next,
      phase: 'executing',
      currentStep: activeIndex,
      steps: next.steps.map((step, index) => (
        index === activeIndex ? { ...step, status: 'running' } : step
      )),
    };
  }
  if (update.phase === 'step-retrying') {
    const retryIndex = Math.max(0, Number(update.step || 1) - 1);
    return {
      ...next,
      phase: 'executing',
      currentStep: retryIndex,
      steps: next.steps.map((step, index) => (
        index === retryIndex
          ? {
            ...step,
            status: 'retrying',
            attempt: Number(update.attempt || 2),
            maxAttempts: Number(update.maxAttempts || 3),
            retryError: String(update.error || ''),
          }
          : step
      )),
    };
  }
  if (update.phase === 'step-completed' || update.phase === 'step-error') {
    const completedIndex = Math.max(0, Number(update.step || 1) - 1);
    return {
      ...next,
      steps: next.steps.map((step, index) => (
        index === completedIndex
          ? {
            ...step,
            status: update.phase === 'step-error' ? 'error' : 'done',
            result: String(update.result || ''),
          }
          : step
      )),
    };
  }
  if (update.phase === 'synthesizing') return { ...next, phase: 'synthesizing' };
  return next;
}
const HISTORY_ATTACHMENT_CHAR_LIMIT = 24000;
const MAX_HISTORY_MESSAGES_FOR_MODEL = 32;
const MAX_HISTORY_CHARS_FOR_MODEL = 48000;
const MAX_GREETING_HISTORY_MESSAGES = 6;
const MAX_GREETING_HISTORY_CHARS = 4000;
const IMAGE_GEN_PATTERN = /\[IMAGE_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const VIDEO_GEN_PATTERN = /\[VIDEO_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const MEDIA_REQUEST_PATTERN = /\b(video|videos|clip|clips|media|reel|reels|youtube|instagram|social\s+posts?)\b|\b(show|find|fetch|get|search|check|look\s+up|more)\b[^.!?]{0,40}\b(images|photos|pictures)\b|\b(images|photos|pictures)\b[^.!?]{0,40}\b(show|find|fetch|get|search|check|look\s+up|more)\b/i;
const EXPLICIT_MEDIA_SEARCH_PATTERN = /\b(show|find|fetch|get|search|look\s+up|pull|give|include|add)\b[^.!?]{0,70}\b(videos?|clips?|media|images?|photos?|pictures?|reels?)\b|\b(videos?|clips?|media|images?|photos?|pictures?|reels?)\b[^.!?]{0,70}\b(show|find|fetch|get|search|look\s+up|pull|give|include|add)\b/i;
const EXPLICIT_VISUAL_WEB_SEARCH_PATTERN = /\b(who\s+is\s+this|who\s+is\s+in\s+this\s+image|find\s+this\s+online|find\s+this\s+on\s+the\s+web|search\s+this\s+product|search\s+this\s+image|search\s+this\s+online|look\s+this\s+up|look\s+this\s+up\s+online|check\s+this\s+online|verify\s+this\s+online|find\s+out\s+what\s+product\s+this\s+is|search\s+the\s+web\s+for\s+this|identify\s+this\s+online)\b/i;
const EXPLICIT_EXTERNAL_SEARCH_PATTERN = /\b(search|browse|look\s+up|find\s+online|web|internet|online|latest|current|today|recent|live|news|verify|fact[-\s]?check|cross[-\s]?check|up[-\s]?to[-\s]?date)\b/i;
const CONTEXTUAL_DEVICE_MEDIA_PATTERN = /\b(this|that|the)\s+(device|product|tool|item|object|thing|model|prototype|machine|system)\b|\b(tell me more|more about|details about|background on|explain)\b[^.!?]{0,70}\b(this|that|it|device|product|object|thing|model|prototype|machine|system)\b/i;
const CONTEXT_REFERENCE_PATTERN = /\b(it|its|this|that|these|those|they|them|their|theirs|his|her|hers|same|former|latter|(?:the|this|that)\s+(device|product|tool|item|object|thing|company|brand|manufacturer|maker|producer|person|model|app|software|platform|service|system|prototype|machine|game|studio|developer|publisher|market))\b/i;
const CONTEXTUAL_WEB_RESEARCH_PATTERN = /\b(company|companies|manufacturer|manufactures?|producer|produces?|producing|maker|made\s+by|built\s+by|created\s+by|developed\s+by|owner|owned\s+by|founder|team|organization|brand|official|website|source|origin|specs?|features?|pricing|price|cost|availability|launch|release|details?|in[-\s]?depth|deep\s+dive|full\s+information|complete\s+information|let\s+me\s+know|tell\s+me\s+more|more\s+about|background|research|explain)\b/i;
const SHORT_CONTEXT_FOLLOWUP_PATTERN = /\b(are\s+you\s+sure|sure\s+about\s+that|really|seriously|wait|why\??|how\s+so|what\s+do\s+you\s+mean|continue|go\s+on|tell\s+me\s+more|more|elaborate|explain\s+that)\b/i;
const SEARCH_WORTHY_CONTEXT_PATTERN = /\b(company|manufacturer|maker|producer|brand|official\s+website|specs?|pricing|price|cost|availability|launch|release|latest|current|current\s+status|market|marketplace|research|analysis|revenue|sales|audience|competitors?|who\s+makes|who\s+owns|what\s+company|where\s+to\s+buy|how\s+much|how\s+many)\b/i;
const CONTEXT_ENTITY_STOP = new Set(['I', 'The', 'A', 'An', 'It', 'This', 'That', 'These', 'Those', 'You', 'He', 'She', 'We', 'They', 'My', 'Your', 'MIRA', 'AI', 'PDF', 'DOCX', 'PPTX']);
const TEXT_ENTITY_RESEARCH_PATTERN = /\b(tell\s+me\s+about|tell\s+me\s+more\s+about|details?\s+about|information\s+about|info\s+about|background\s+on|research|explain|what\s+is|what\s+are|what\s+an|what\s+a|what's|overview\s+of|in\s+detail|deep\s+dive|let\s+me\s+know\s+what)\b/i;
const MEDIA_RELEVANCE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'about',
  'tell', 'show', 'find', 'search', 'images', 'image', 'photos', 'photo', 'videos', 'video',
  'something', 'more', 'details', 'information', 'latest', 'current',
]);

function normalizeSearchComparison(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function filterRelevantMedia(items = [], query = '') {
  const expandedQuery = expandCompoundWords(String(query || ''));
  const tokens = Array.from(new Set(
    expandedQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !MEDIA_RELEVANCE_STOPWORDS.has(token))
  )).slice(0, 5);
  if (!tokens.length) return Array.isArray(items) ? items : [];
  const required = tokens.length >= 2 ? 2 : 1;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const haystack = normalizeSearchComparison(expandCompoundWords(
      `${item?.title || ''} ${item?.source || ''} ${item?.url || ''}`,
    ));
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0) >= required;
  });
}

function filterHighConfidenceArticles(items = [], query = '') {
  return filterRelevantMedia(items, query)
    .filter((item) => Number(item?.confidence || 0) >= 0.55);
}

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

const TEXT_ENTITY_STOP = new Set(['tell', 'me', 'about', 'more', 'details', 'detail', 'information', 'info', 'background', 'research', 'explain', 'what', 'is', 'whats', 'overview', 'deep', 'dive', 'in', 'detail', 'the', 'a', 'an', 'this', 'that', 'it', 'please', 'can', 'you', 'know', 'latest', 'current', 'complete', 'full', 'video', 'videos', 'image', 'images', 'media', 'fetch', 'find', 'get', 'show', 'give', 'pull', 'few', 'some', 'related', 'relevant']);

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
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return /[A-Z]/.test(normalized) ? normalized : titleCaseEntity(normalized);
}

function extractTextResearchEntity(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || (!TEXT_ENTITY_RESEARCH_PATTERN.test(value) && !isMediaRequest(value))) return '';

  const quoted = value.match(/["“]([^"”]{2,80})["”]/)?.[1]?.trim();
  if (quoted) return canonicalizeTextEntity(quoted);

  const explicitMediaSubject = value.match(/\b(?:images?|photos?|pictures?|videos?|clips?|media|reels?)\s+(?:of|about|for)\s+(?:the\s+)?([^?!.,;:]{2,80})/i)?.[1]?.trim();
  if (explicitMediaSubject && !/^(?:this|that|it|them|these|those)$/i.test(explicitMediaSubject)) {
    return canonicalizeTextEntity(explicitMediaSubject);
  }

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
    const data = await searchWeb({
      query: scope.query,
      includeMedia: true,
      mediaQuery: scope.mediaQuery || scope.query,
      anchor: scope.entity || scope.mediaQuery || scope.query,
      strictAnchor: true,
    }, {
      attemptsPerQuery: 1,
      retryEmpty: true,
    });
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

function getLatestConversationSubject(historySource = []) {
  const recent = Array.isArray(historySource) ? historySource.slice(-8) : [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const text = normalizeMessageContent(message?.promptContent || message?.content || '');
    const entities = extractContextEntities(message?.media?.query || text);
    if (entities.length) return entities[0];
  }
  return '';
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

async function persistGeneratedImageAsset({
  prompt,
  userId,
  conversationId,
  messageId,
  allowNsfw = false,
  referenceImage = '',
}) {
  const cleanPrompt = cleanImagePrompt(prompt);
  if (!cleanPrompt || !userId || !conversationId || !messageId) return null;

  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'persist-image',
      prompt: cleanPrompt,
      unsafe: Boolean(allowNsfw),
      userId,
      conversationId,
      messageId,
      width: 1280,
      height: 1280,
      seed: imagePromptSeed(cleanPrompt),
      ...(referenceImage ? { referenceImage } : {}),
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
  const prompt = cleanImagePrompt(markerPrompt).slice(0, 1200);
  return prompt
    ? `Generated an image from this prompt: "${prompt}".`
    : 'Generated an image in the previous assistant turn.';
}

function getLatestGeneratedVideoPrompt(historySource = []) {
  const message = getMostRecentAssistantMessage(Array.isArray(historySource) ? historySource : []);
  const text = normalizeMessageContent(message?.promptContent || message?.content || '');
  const markerPrompt = String(text || '').match(VIDEO_GEN_PATTERN)?.[1]?.trim();
  const cleaned = cleanVideoPrompt(markerPrompt || '');
  return cleaned ? cleaned.slice(0, 900) : '';
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
    activeProjectId,
  } = useChatContext();
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [taskWorkflow, setTaskWorkflow] = useState(null);
  const abortRef = useRef(false);
  const lastStableAssistantByIdRef = useRef(new Map());
  // rAF-coalesced streaming state setters: every model token would otherwise
  // trigger a full React re-render (heavy with ReactMarkdown). Collapse all
  // updates within the same frame into one paint to keep typing buttery.
  const pendingStreamRef = useRef(null);
  const pendingThinkingRef = useRef(null);
  const streamRafRef = useRef(null);
  const thinkingRafRef = useRef(null);
  const titleSessionRef = useRef({ conversationId: null, messages: [] });
  const generationRunRef = useRef(0);
  const activeResponseRef = useRef(null);
  const workspaceHistoryRef = useRef([]);

  const refreshWorkspaceHistory = useCallback(async () => {
    try {
      const memory = await getDesktopWorkspaceMemory();
      const history = buildWorkspaceHistoryMessages(memory);
      workspaceHistoryRef.current = history;
      setMessages((previous) => mergeWorkspaceHistoryMessages(
        history,
        currentConversationId
          ? previous.filter((message) => !message?.workspaceHistory)
          : [],
      ));
    } catch (error) {
      diagnosticWarn('context', 'desktop workspace history could not be restored', {
        error: error?.message || 'Unknown workspace history error',
      });
    }
  }, [currentConversationId]);

  const persistConversationUpdate = useCallback(async (conversationId, data) => {
    if (!user?.uid || !conversationId) return;
    if (activeProjectId) await updateProjectConversation(activeProjectId, conversationId, data);
    else await updateConversation(user.uid, conversationId, data);
  }, [activeProjectId, user?.uid]);

  const refreshConversationTitle = useCallback(async (conversationId, transcript = []) => {
    if (!user?.uid || !conversationId || !Array.isArray(transcript) || transcript.length === 0) return;
    const title = await generateConversationTitle(transcript);
    if (!title || title === 'New Chat') return;
    if (activeProjectId) await updateProjectConversation(activeProjectId, conversationId, { title, titleUpdatedAt: Date.now() });
    else await updateConversationTitle(user.uid, conversationId, title);
  }, [activeProjectId, user?.uid]);

  const flushStreamingContent = useCallback((value) => {
    if (abortRef.current) return;
    const visibleValue = humanizeAssistantText(value);
    pendingStreamRef.current = visibleValue;
    if (activeResponseRef.current) {
      activeResponseRef.current.content = visibleValue;
      activeResponseRef.current.syncWriter?.push({
        content: visibleValue,
        isStreaming: true,
        streamUpdatedAt: Date.now(),
      });
    }
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

  const finalizeActiveResponse = useCallback(async () => {
    const active = activeResponseRef.current;
    activeResponseRef.current = null;
    if (!active?.conversationId || !active?.messageId) return;

    const partialContent = String(active.content || '').trim();
    await active.syncWriter?.finish();
    if (partialContent) {
      setMessages((prev) => prev.map((message) => (
        message.id === active.messageId
          ? { ...message, content: partialContent, interrupted: true, isStreaming: false }
          : message
      )));
      await updateMessage(active.conversationId, active.messageId, {
        content: partialContent,
        interrupted: true,
        isStreaming: false,
      });
      return;
    }

    setMessages((prev) => prev.filter((message) => message.id !== active.messageId));
    await deleteMessage(active.conversationId, active.messageId);
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
    refreshWorkspaceHistory();
    window.addEventListener('mira:workspace-changed', refreshWorkspaceHistory);
    return () => window.removeEventListener('mira:workspace-changed', refreshWorkspaceHistory);
  }, [refreshWorkspaceHistory]);

  useEffect(() => {
    const previous = titleSessionRef.current;
    if (previous.conversationId && previous.conversationId !== currentConversationId) {
      refreshConversationTitle(previous.conversationId, previous.messages).catch(() => {});
    }
    titleSessionRef.current = {
      conversationId: currentConversationId,
      messages: currentConversationId ? messages : [],
    };
  }, [currentConversationId, refreshConversationTitle]);

  useEffect(() => {
    if (titleSessionRef.current.conversationId === currentConversationId) {
      titleSessionRef.current.messages = messages;
    }
  }, [currentConversationId, messages]);

  useEffect(() => {
    const finalizeCurrentTitle = () => {
      const current = titleSessionRef.current;
      if (current.conversationId && current.messages.length > 0) {
        refreshConversationTitle(current.conversationId, current.messages).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finalizeCurrentTitle();
    };
    window.addEventListener('pagehide', finalizeCurrentTitle);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', finalizeCurrentTitle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      finalizeCurrentTitle();
    };
  }, [refreshConversationTitle]);

  useEffect(() => {
    if (!currentConversationId) {
      setMessages(workspaceHistoryRef.current);
      return;
    }

    // Do not render the previous chat while the requested URL-backed session
    // is loading its own realtime timeline.
    setMessages([]);
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
        const merged = mergeWorkspaceHistoryMessages(workspaceHistoryRef.current, next);
        if (!pendingLocalEchoes.length) return merged;

        const incomingFingerprints = new Set(merged.map((msg) => messageFingerprint(msg)));
        const unresolvedEchoes = pendingLocalEchoes.filter(
          (msg) => !incomingFingerprints.has(messageFingerprint(msg)),
        );

        if (!unresolvedEchoes.length) return merged;
        return [...merged, ...unresolvedEchoes];

      });
    });
    return unsub;
  }, [currentConversationId]);

  useEffect(() => {
    if (!currentConversationId || activeProjectId || isGenerating) return undefined;
    const interrupted = messages.filter((message) => (
      message?.role === 'assistant' && message?.isStreaming
    ));
    if (!interrupted.length) return undefined;

    const timer = setTimeout(() => {
      if (activeResponseRef.current?.conversationId === currentConversationId) return;
      const interruptedIds = new Set(interrupted.map((message) => message.id));
      setMessages((previous) => previous.map((message) => (
        interruptedIds.has(message.id)
          ? {
            ...message,
            content: String(message.content || '').trim()
              || 'This response was interrupted when the session reloaded. Please retry to continue.',
            interrupted: true,
            isStreaming: false,
          }
          : message
      )));
      interrupted.forEach((message) => {
        updateMessage(currentConversationId, message.id, {
          content: String(message.content || '').trim()
            || 'This response was interrupted when the session reloaded. Please retry to continue.',
          interrupted: true,
          isStreaming: false,
          streamCompletedAt: Date.now(),
        }).catch((error) => {
          diagnosticWarn('stream', 'interrupted response recovery failed', {
            conversationId: currentConversationId,
            messageId: message.id,
            error: error?.message || 'Unknown persistence error',
          });
        });
      });
    }, 2500);

    return () => clearTimeout(timer);
  }, [activeProjectId, currentConversationId, isGenerating, messages]);

  const stopGenerating = useCallback(() => {
    generationRunRef.current += 1;
    abortRef.current = true;
    stopChatGeneration();
    cancelPendingStreamFlushes();
    setIsGenerating(false);
    setIsSearching(false);
    setStreamingContent('');
    setThinkingContent('');
    setTaskWorkflow((current) => (
      current?.status === 'running'
        ? { ...current, phase: 'stopped', status: 'stopped', updatedAt: Date.now() }
        : current
    ));
    finalizeActiveResponse().catch((error) => {
      console.warn('Failed to finalize interrupted response:', error?.message);
    });
  }, [cancelPendingStreamFlushes, finalizeActiveResponse, setIsGenerating, setIsSearching]);

  useEffect(() => {
    const removeExitCancellation = installGenerationExitCancellation();
    return () => {
      stopChatGeneration();
      removeExitCancellation();
    };
  }, []);

  const pruneMessagesAfter = useCallback(async (convId, messageId, sourceMessages = messages) => {
    const index = sourceMessages.findIndex((message) => message.id === messageId);
    if (index === -1) return [];

    const trailing = sourceMessages.slice(index + 1);
    await Promise.all(trailing.map((message) => deleteMessage(convId, message.id)));
    return sourceMessages.slice(0, index);
  }, [messages]);

  const sendMessage = useCallback(
    async (content, attachments = [], webSearch = false, options = {}) => {
      if ((!content.trim() && attachments.length === 0) || !user) return;
      const interruptExisting = Boolean(options.interruptExisting || options.replaceMessageId);
      if (isGenerating && !interruptExisting) return;
      const runId = generationRunRef.current + 1;
      const projectRunToken = `${user.uid}-${Date.now()}-${runId}`;
      const messageAuthor = options.author?.uid ? options.author : profile;
      const isActingForAnotherUser = messageAuthor.uid !== user.uid;
      const requestProfile = isActingForAnotherUser ? messageAuthor : profile;
      let lockedConversationId = null;

      if (activeProjectId && currentConversationId) {
        const acquired = await acquireConversationRun(currentConversationId, projectRunToken, messageAuthor);
        if (!acquired) {
          if (options.queueOnBusy !== false) {
            await enqueueConversationPrompt(currentConversationId, {
              content,
              attachments,
              webSearch,
              conversationId: currentConversationId,
            }, messageAuthor);
          }
          return { queued: true };
        }
        lockedConversationId = currentConversationId;
      }
      generationRunRef.current = runId;
      const interruptedResponse = options.steering && activeResponseRef.current?.content
        ? { ...activeResponseRef.current }
        : null;
      if (isGenerating) {
        stopChatGeneration();
        cancelPendingStreamFlushes();
        try {
          await finalizeActiveResponse();
        } catch (error) {
          console.warn('Failed to finalize steered response:', error?.message);
        }
      }

      const isCurrentRun = () => generationRunRef.current === runId && !abortRef.current;
      abortRef.current = false;
      cancelPendingStreamFlushes();
      setIsGenerating(true);
      setStreamingContent('');
      setThinkingContent('');

      let convId = currentConversationId;
      const replaceMessageId = options.replaceMessageId || null;
      let assistantMsgId = null;
      let completedAnswer = '';

      const textAttachments = attachments.filter((a) => !a.isImage);
      const imageAttachments = attachments.filter((a) => a.isImage);

      let displayContent = String(options.displayContent || content);
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
          author: messageAuthor,
          localEcho: true,
        };
        setMessages((prev) => [...prev, localEcho]);
      }

      const hasImages = imageAttachments.length > 0;
      const engineResult = processQuery(content, hasImages);
      const promptInterpretation = engineResult.interpretation || {
        route: engineResult.classification.intent,
        codeIntent: engineResult.classification.intent === 'code',
        imageIntent: engineResult.classification.intent === 'image',
        videoIntent: engineResult.classification.intent === 'video',
      };
      diagnosticLog('model', 'request classification', {
        runId,
        intent: engineResult.classification?.intent || 'unknown',
        hasImages,
        needsSearch: Boolean(engineResult.needsSearch),
      });
      let wantsImageGeneration = promptInterpretation.imageIntent === true;
      let wantsVideoGeneration = promptInterpretation.videoIntent === true;
      const simpleGreeting = !hasImages && attachments.length === 0 && isSimpleGreeting(content);
      const requestedDocumentFormat = (wantsImageGeneration || wantsVideoGeneration)
        ? null
        : detectDocumentRequest(content, textAttachments.length > 0);
      const shouldThink = shouldUseModelThinking({
        complexity: engineResult.classification?.complexity,
        hasAttachments: attachments.length > 0,
        document: Boolean(requestedDocumentFormat),
      });
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
            const acquired = await acquireConversationRun(convId, projectRunToken, messageAuthor);
            if (!acquired) throw new Error('This project chat became busy. Please send again.');
            lockedConversationId = convId;
          }
        }
        if (!isCurrentRun()) return;

        let historySource = isNewChat
          ? messages.filter((message) => message?.workspaceHistory)
          : messages;
        if (interruptedResponse?.content) {
          const interruptedIndex = historySource.findIndex(
            (message) => message.id === interruptedResponse.messageId,
          );
          if (interruptedIndex >= 0) {
            historySource = historySource.map((message, index) => (
              index === interruptedIndex
                ? { ...message, content: interruptedResponse.content, interrupted: true }
                : message
            ));
          } else {
            historySource = [
              ...historySource,
              { role: 'assistant', content: interruptedResponse.content, interrupted: true },
            ];
          }
        }
        if (replaceMessageId) {
          historySource = await pruneMessagesAfter(convId, replaceMessageId, historySource);
        }
        if (!isCurrentRun()) return;

        const previousImageContext = getPreviousGeneratedImageContext(historySource);
        const previousImagePrompt = cleanImagePrompt(previousImageContext?.prompt || '').slice(0, 4000);
        const previousImageReference = String(previousImageContext?.referenceImage || '').trim();
        const previousVideoPrompt = getLatestGeneratedVideoPrompt(historySource);
        const wantsImageRefinementFollowup = (
          !hasImages
          && !wantsVideoGeneration
          && Boolean(previousImagePrompt)
          && Boolean(previousImageReference)
          && isPreviousImageEditRequest(content)
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
        const wantsMediaGallery = isMediaRequest(content);
        const wantsOnlyMediaGallery = isMediaOnlyRequest(content);
        const shouldUseVisualAnchor = needsVisualSearchAnchor(content, hasImages);
        const shouldAttachContextualMedia = wantsContextualDeviceMedia(content);
        const textResearchMediaScope = buildTextResearchMediaScope(content);
        const shouldUseContextualSearch = needsContextualWebSearch(content, historySource);
        const websiteInspectionRequest = detectWebsiteInspectionRequest(content);
        const explicitlyRequestsExternalSearch = Boolean(
          webSearch
          || EXPLICIT_MEDIA_SEARCH_PATTERN.test(content)
          || shouldUseVisualAnchor
          || EXPLICIT_EXTERNAL_SEARCH_PATTERN.test(content)
        );
        const hasAuthoritativeContext = textAttachments.length > 0 && !explicitlyRequestsExternalSearch;
        const retrievalPolicy = decideRetrievalPolicy({
          manualSearch: webSearch,
          engineNeedsSearch: hasAuthoritativeContext ? false : engineResult.needsSearch,
          websiteInspection: Boolean(websiteInspectionRequest),
          simpleGreeting,
          mediaRequested: wantsMediaGallery,
          visualSearch: shouldUseVisualAnchor,
          contextualSearch: shouldUseContextualSearch,
          contextualMedia: shouldAttachContextualMedia || Boolean(textResearchMediaScope),
          hasAuthoritativeContext,
        });
        const agentRuntime = getAgentRuntimeCapabilities();
        const desktopWorkspaceRequest = classifyDesktopWorkspaceRequest(content, agentRuntime);
        let workspaceMemoryBlock = '';
        if (agentRuntime.runtime === 'desktop' && !simpleGreeting) {
          try {
            workspaceMemoryBlock = buildWorkspaceMemoryPrompt(await getDesktopWorkspaceMemory());
          } catch (memoryError) {
            diagnosticWarn('context', 'desktop workspace memory could not be loaded', {
              error: memoryError?.message || 'Unknown workspace memory error',
            });
          }
        }
        const allowedModelTools = selectModelTools({
          disableTools: simpleGreeting,
          allowWebSearch: retrievalPolicy.allowSearchTool,
          allowImageGeneration: wantsImageGeneration,
          allowVideoGeneration: wantsVideoGeneration,
          runtime: agentRuntime,
        });

        const history = buildModelHistory(historySource, promptInterpretation, { isGreeting: simpleGreeting });

        // ── Adaptive user context (token-efficient) ──
        // Cache profile locally so heuristic + future sessions can use it.
        if (!isActingForAnotherUser) cacheProfile(profile);
        const currentConversation = Array.isArray(chatConversations)
          ? chatConversations.find((c) => c?.id === convId)
          : null;
        let projectImageAnalyses = [];
        let sharedProjectContext = null;
        if (activeProjectId && !simpleGreeting) {
          try {
            sharedProjectContext = await getProjectContext(activeProjectId);
          } catch (contextError) {
            diagnosticWarn('context', 'shared project context could not be loaded', {
              projectId: activeProjectId,
              error: contextError?.message || 'Unknown context error',
            });
          }
        }
        const sharedProjectContextBlock = buildProjectContextPrompt(sharedProjectContext, {
          currentConversationId: convId,
        });
        const persistProjectTurn = async (assistantText) => {
          if (!activeProjectId || !assistantMsgId || !String(assistantText || '').trim()) return;
          const turn = buildProjectContextTurn({
            userText: content,
            assistantText,
            attachments: textAttachments,
            imageAnalyses: projectImageAnalyses,
            author: messageAuthor,
            conversationTitle: currentConversation?.title || 'Project chat',
          });
          try {
            await saveProjectContextTurn(activeProjectId, convId, assistantMsgId, turn);
          } catch (contextError) {
            diagnosticWarn('context', 'shared project context could not be updated', {
              projectId: activeProjectId,
              conversationId: convId,
              error: contextError?.message || 'Unknown context error',
            });
          }
        };
        const persistWorkspaceTurn = async (assistantText) => {
          if (agentRuntime.runtime !== 'desktop' || !String(assistantText || '').trim()) return;
          try {
            await appendDesktopWorkspaceTurn({
              conversationId: convId,
              turnId: assistantMsgId,
              user: content,
              assistant: assistantText,
              attachments: attachmentData.map((attachment) => attachment.name).filter(Boolean),
            });
          } catch (memoryError) {
            diagnosticWarn('context', 'desktop workspace turn could not be saved', {
              error: memoryError?.message || 'Unknown workspace memory error',
            });
          }
        };
        const isFirstTurn = (historySource?.length || 0) === 0;
        const contextMode = decideContextMode(content, isFirstTurn);
        const adaptiveLearningEnabled = !isActingForAnotherUser && profile?.preferences?.adaptiveLearning !== false;
        if (adaptiveLearningEnabled) learnResponsePreferences(content, { scope: messageAuthor.uid });
        const learnedFactsBlock = buildLearnedFactsBlock();
        const responsePreferencesBlock = adaptiveLearningEnabled
          ? buildResponsePreferencesBlock(profile?.preferences, { scope: messageAuthor.uid })
          : '';
        const adaptiveContext = buildAdaptiveContext({
          profile: requestProfile,
          conversation: currentConversation,
          messages: historySource,
          mode: contextMode,
          learnedFacts: learnedFactsBlock,
        });
        const modalityBoundary = wantsImageGeneration
          ? 'CURRENT TURN MODE: The user explicitly requested image generation or refinement. Image generation is allowed for this turn.'
          : wantsVideoGeneration
            ? 'CURRENT TURN MODE: The user explicitly requested video generation or refinement. Video generation is allowed for this turn.'
            : 'CURRENT TURN MODE: Respond in text. Do not generate or refine images or videos, do not call media-generation tools, and do not carry a prior media task into this turn.';
        // Mira's stable identity and behavior contract live in the Ollama
        // model. Only small request-specific context crosses the network.
        const runtimeContextBlock = [
          modalityBoundary,
          desktopWorkspaceRequest.active
            ? `DESKTOP WORKSPACE REQUEST: Work against the open workspace now. Begin by inspecting the actual files, continue calling the provided filesystem, command, test, change-review, and Git tools until the request is complete, then report only confirmed results. ${desktopWorkspaceRequest.mutation ? 'This is an implementation request: do not stop at recommendations; apply the requested changes, inspect the resulting diff, run regression validation, and fix failures before answering.' : 'This is an inspection request: read representative source and configuration files before summarizing.'} ${desktopWorkspaceRequest.execution ? 'The user requested execution: run the relevant command in the in-app terminal and use its actual result.' : ''} ${desktopWorkspaceRequest.serverStart ? 'This is a server-start request: launch the detected development server as a persistent terminal process; do not substitute a project summary.' : ''}`
            : '',
          buildSearchToolGuidance(retrievalPolicy),
          sharedProjectContextBlock,
          workspaceMemoryBlock,
          responsePreferencesBlock,
          adaptiveContext,
        ]
          .filter(Boolean)
          .join('\n\n');

        const assistantTimestamp = Date.now() + 1;
        const assistantWrite = addMessage(convId, {
          role: 'assistant',
          content: '',
          type: 'text',
          timestamp: assistantTimestamp,
          generatedBy: messageAuthor,
          isStreaming: true,
          streamStartedAt: assistantTimestamp,
        });
        if (replaceMessageId) {
          [, assistantMsgId] = await Promise.all([
            updateMessage(convId, replaceMessageId, {
              content: displayContent,
              type: 'text',
              ...(options.promptContent ? { promptContent: options.promptContent } : { promptContent: null }),
              ...(options.webPage ? { webPage: options.webPage } : { webPage: null }),
              ...(attachmentData.length > 0 ? { attachments: attachmentData } : { attachments: null }),
            }),
            assistantWrite,
          ]);
        } else {
          [, assistantMsgId] = await Promise.all([
            addMessage(convId, {
              role: 'user',
              content: displayContent,
              type: 'text',
              timestamp: assistantTimestamp - 1,
              ...(options.promptContent ? { promptContent: options.promptContent } : {}),
              ...(options.webPage ? { webPage: options.webPage } : {}),
              ...(attachmentData.length > 0 ? { attachments: attachmentData } : {}),
              author: messageAuthor,
            }),
            assistantWrite,
          ]);
        }
        if (!isCurrentRun()) {
          await deleteMessage(convId, assistantMsgId).catch(() => {});
          return;
        }

        activeResponseRef.current = {
          runId,
          conversationId: convId,
          messageId: assistantMsgId,
          content: '',
          syncWriter: createThrottledRealtimeWriter(
            (payload) => updateMessage(convId, assistantMsgId, payload),
            {
              intervalMs: activeProjectId ? 250 : 400,
              onError: (error) => console.warn('Answer live sync failed:', error?.message || error),
            },
          ),
        };

        if (simpleGreeting) {
          const greetingResponse = buildGreetingResponse(content);
          await updateMessage(convId, assistantMsgId, { content: greetingResponse, isStreaming: false });
          setMessages((prev) => prev.map((message) => (
            message.id === assistantMsgId ? { ...message, content: greetingResponse } : message
          )));
          await persistWorkspaceTurn(greetingResponse);
          return;
        }

        // ── Prompt enhancer / clarification gate ──
        // Before dispatching the main request, ask the same model to
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
            if (isCurrentRun()) {
              if (decision.action === 'clarify') {
                await updateMessage(convId, assistantMsgId, {
                  content: decision.question,
                  isClarification: true,
                  isStreaming: false,
                });
                if (isNewChat) {
                  generateSmartTitle(content, decision.question).then((title) => {
                    persistConversationUpdate(convId, { title });
                  });
                }
                refreshConversationTitle(convId, [
                  ...historySource,
                  { role: 'user', content },
                  { role: 'assistant', content: decision.question },
                ]).catch(() => {});
                await persistWorkspaceTurn(decision.question);
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
        let workspaceChangesForMessage = [];
        let deterministicMediaReply = null;
        let groundingSearchData = null;
        let groundingSearchQuery = '';
        let groundingFreshnessRequested = false;

        {
          let userContent = options.promptContent || enhancedContent || content;
          if (runtimeContextBlock) {
            userContent = `${userContent}\n\n=== CURRENT REQUEST CONTEXT ===\n${runtimeContextBlock}\n=== END CURRENT REQUEST CONTEXT ===`;
          }

          const recentContextAnchor = getRecentContextAnchor(historySource);
          const latestConversationSubject = getLatestConversationSubject(historySource);
          const recentConversationContext = needsRecentConversationContext(content, historySource)
            ? buildRecentConversationContext(historySource)
            : '';
          const recentConversationContextBlock = recentConversationContext
            ? `\n\n=== RECENT CONVERSATION CONTEXT FOR THIS FOLLOW-UP ===\n${latestConversationSubject ? `Immediate subject: ${latestConversationSubject}\n` : ''}${recentConversationContext}\n=== END RECENT CONVERSATION CONTEXT ===\n\nThe immediately preceding exchange is the highest-priority context. Resolve pronouns and possessives such as “it”, “their”, “that game”, or “the company” against that exchange. Do not substitute an older project or search topic unless the user explicitly refers back to it. If the previous turn generated an image, treat questions like "are you sure?" as referring to that generated image/prompt unless the user clearly changes topic.`
            : '';
          if (recentConversationContextBlock) {
            userContent = `${userContent}${recentConversationContextBlock}`;
          }
          const effectiveWebSearch = retrievalPolicy.search;
          const responseModelTools = allowedModelTools;
          if (websiteInspectionRequest) {
            diagnosticLog('browser', 'website inspection intent takes precedence over web search', {
              runId,
              url: websiteInspectionRequest.arguments.url,
              task: websiteInspectionRequest.arguments.task,
            });
            userContent = `${userContent}\n\nWEBSITE INSPECTION REQUEST: Call browser.inspect now using the MIRA_TOOL safeword. Do not answer from web search or general knowledge.`;
          }
          if (retrievalPolicy.searchPriority) {
            diagnosticLog('search', 'web search prioritized for model tool selection', {
              runId,
              manualToggle: Boolean(webSearch),
              engineRequested: Boolean(engineResult.needsSearch),
              visualAnchor: Boolean(shouldUseVisualAnchor),
              contextualSearch: Boolean(shouldUseContextualSearch),
              researchScope: Boolean(textResearchMediaScope),
            });
          }
          let visualSearchAnchor = '';
          let visionAnalysisBlock = '';
          if (hasImages) {
            const normalizedVisionImages = await Promise.all(
              imageAttachments.map((image) => normalizeImageForUpload(image)),
            );
            const analyses = await Promise.allSettled(normalizedVisionImages.map((image, index) => analyzeImage(
              buildVisionAnalysisPrompt(content, index, normalizedVisionImages.length),
              image,
              image.mimeType,
            )));
            const successfulAnalyses = analyses.flatMap((analysis, index) => (
              analysis.status === 'fulfilled' && analysis.value?.result
                ? [{ index, text: String(analysis.value.result).trim() }]
                : []
            ));
            if (!successfulAnalyses.length) {
              const failure = analyses.find((analysis) => analysis.status === 'rejected');
              throw new Error(failure?.reason?.message || 'Image analysis failed.');
            }
            projectImageAnalyses = successfulAnalyses.map(({ index, text }) => ({
              name: imageAttachments[index]?.name || `Image ${index + 1}`,
              summary: text,
            }));
            if (shouldUseVisualAnchor) {
              visualSearchAnchor = cleanVisualSearchAnchor(
                extractVisionSearchAnchor(successfulAnalyses[0].text),
              );
            }
            visionAnalysisBlock = `\n\n=== VERIFIED IMAGE ANALYSIS ===\n${successfulAnalyses
              .map(({ index, text }) => `Image ${index + 1}:\n${text}`)
              .join('\n\n')}\n=== END IMAGE ANALYSIS ===\n\nUse this dedicated vision analysis as the source of truth for the attached image. Answer the user's request directly. Do not claim you inspected image pixels yourself, and do not expose internal provider or model details.`;
          }

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
            // Extract the subject from common Hinglish research phrasing:
            // "Mujhe X ke baare mein ... batao" -> "X".
            const hinglishSubject = value.match(/^(?:mujhe|mere\s+ko)\s+(.+?)\s+ke\s+baare\s+(?:me|mein)\b/i)?.[1]?.trim();
            if (hinglishSubject) value = hinglishSubject;
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

            const PRONOUN_RE = CONTEXT_REFERENCE_PATTERN;
            const looksReferential = current.length < 80 || PRONOUN_RE.test(current);
            const fallback = useCleaned ? cleaned : current;
            if (!looksReferential || historySource.length === 0) return fallback;

            const dedup = latestConversationSubject ? [latestConversationSubject] : [];
            if (!dedup.length) return fallback;

            // Pull a couple of meaningful keywords from the current message
            // (skip stopwords and the pronouns we used to detect referentiality).
            const STOP_KW = new Set(['can','you','tell','me','more','about','this','that','the','a','an','is','are','was','were','do','does','did','what','how','why','when','where','please','it','its','they','them','their','theirs','his','her','hers','these','those','same','former','latter','of','to','for','on','in','with','and','or','but','know','let','hello','hi','hey','search','find','look','dig','digging','some','do']);
            const kw = (useCleaned ? cleaned : current).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
              .filter((w) => w.length > 2 && !STOP_KW.has(w))
              .slice(0, 2);

            // Final query: entities first (they carry the topic), then a couple
            // of keywords from the current question. Short and search-friendly.
            return [...dedup, ...kw].join(' ').trim() || fallback;
          };

          let formedLatestQueryPromise = null;
          const getLatestMessageSearchQuery = (toolHint = '') => {
            if (formedLatestQueryPromise) return formedLatestQueryPromise;
            const latestIsContextDependent = CONTEXT_REFERENCE_PATTERN.test(content)
              || content.trim().split(/\s+/).length <= 2;
            const contextParts = [];
            if (latestIsContextDependent && recentConversationContext) {
              if (latestConversationSubject) {
                contextParts.push(`Recent subject anchor: ${latestConversationSubject}`);
              }
              contextParts.push(recentConversationContext);
            }
            if (visualSearchAnchor) {
              contextParts.push(`Image-derived searchable entity: ${visualSearchAnchor}`);
            }
            if (toolHint) {
              contextParts.push(`Model search hint: ${toolHint}`);
            }
            formedLatestQueryPromise = formSearchQuery({
              latestMessage: content,
              context: contextParts.join('\n\n'),
            });
            return formedLatestQueryPromise;
          };

          // Web search injection — skip when an explicit document export is requested,
          // so unrelated search results don't override the attached/previous file context.
          if (effectiveWebSearch && content.trim() && !requestedDocumentFormat) {
            setIsSearching(true);
            try {
              // Keep the primary web query natural. The entity scope is useful
              // for validating media, but quoting the entire interpreted entity
              // can over-constrain web results (for example
              // "Most Expensive Yacht In India" misses "India's most expensive
              // yacht"). The retry layer can quote a narrower subject later.
              let searchQuery = await getLatestMessageSearchQuery()
                || buildContextualSearchQuery(content)
                || textResearchMediaScope?.query
                || content;
              // Every real web search returns a complete related-media package.
              // Entity-aware filtering below prevents unrelated embeds from
              // being attached to broad or ambiguous queries.
              const shouldAttachRelatedMedia = retrievalPolicy.includeMedia;
              const includeMedia = retrievalPolicy.includeMedia;
              const visualScope = visualSearchAnchor ? buildVisualSearchScope(visualSearchAnchor, content) : null;
              const freshnessRequested = needsFreshInformation(content) || needsFreshInformation(searchQuery);
              const searchPayload = {
                query: searchQuery,
                includeMedia,
                freshness: freshnessRequested,
                requireTextResults: !wantsOnlyMediaGallery,
              };
              diagnosticLog('search', 'router search query prepared', {
                runId,
                query: String(searchQuery).slice(0, 180),
                includeMedia,
                freshness: freshnessRequested,
              });
              if (visualScope?.query) {
                searchPayload.anchor = visualScope.entity || visualSearchAnchor;
                searchPayload.mediaQuery = visualScope.mediaQuery || visualScope.query;
                searchPayload.strictAnchor = true;
              } else if (textResearchMediaScope?.query) {
                searchPayload.anchor = textResearchMediaScope.entity;
                searchPayload.mediaQuery = textResearchMediaScope.mediaQuery || textResearchMediaScope.query;
                searchPayload.strictAnchor = true;
              }
              let searchData = await searchWeb(searchPayload, {
                attemptsPerQuery: 1,
                retryEmpty: true,
              });
              const strictRetryQuery = visualScope?.mediaQuery || textResearchMediaScope?.mediaQuery || visualSearchAnchor;
              const strictRetryAnchor = visualScope?.entity || textResearchMediaScope?.entity || visualSearchAnchor;
              if ((!Array.isArray(searchData.results) || searchData.results.length === 0) && strictRetryQuery && searchQuery !== strictRetryQuery) {
                const retryData = await searchWeb({
                  query: strictRetryQuery,
                  includeMedia,
                  mediaQuery: strictRetryQuery,
                  anchor: strictRetryAnchor,
                  strictAnchor: true,
                  freshness: freshnessRequested,
                }, {
                  attemptsPerQuery: 1,
                  retryEmpty: true,
                });
                const retryHasResults = Array.isArray(retryData.results) && retryData.results.length > 0;
                const retryHasMedia = Array.isArray(retryData.media?.videos) && retryData.media.videos.length > 0
                  || Array.isArray(retryData.media?.images) && retryData.media.images.length > 0;
                if (retryHasResults || retryHasMedia) {
                  searchQuery = strictRetryQuery;
                  searchData = retryData;
                }
              }
              const mediaQueryForMessage = visualScope?.mediaQuery || textResearchMediaScope?.mediaQuery || searchQuery;
              const realVideos = filterRelevantMedia(searchData.media?.videos, mediaQueryForMessage);
              const realImages = filterRelevantMedia(searchData.media?.images, mediaQueryForMessage);
              const articleCandidates = [
                ...(Array.isArray(searchData.media?.articles) ? searchData.media.articles : []),
                ...(Array.isArray(searchData.results) ? searchData.results.map((result) => ({
                  ...result,
                  type: result.type || 'article',
                  confidence: Number(result.confidence || 1),
                })) : []),
              ];
              const realArticles = filterHighConfidenceArticles(articleCandidates, mediaQueryForMessage)
                .filter((article, index, articles) => (
                  articles.findIndex((candidate) => candidate.url === article.url) === index
                ));
              const mediaBlock = (() => {
                if (!shouldAttachRelatedMedia || (!realVideos.length && !realImages.length && !realArticles.length)) return '';
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
                if (realArticles.length) {
                  if (lines.length) lines.push('');
                  lines.push('News and blog articles (auto-rendered below your reply):');
                  realArticles.slice(0, 6).forEach((article, i) => {
                    const title = (article.title || '').replace(/\s+/g, ' ').trim() || 'article';
                    lines.push(`  a${i + 1}. [${article.type || 'article'}] ${title} — ${article.url || ''}`);
                  });
                }
                return `\n\n=== REAL MEDIA GALLERY (already shown to the user as embeds/thumbnails under your reply) ===\n${lines.join('\n')}\n=== END MEDIA GALLERY ===`;
              })();
              if (wantsMediaGallery) {
                if (realVideos.length || realImages.length || realArticles.length) {
                  mediaForMessage = { videos: realVideos, images: realImages, articles: realArticles, query: mediaQueryForMessage };
                  if (wantsOnlyMediaGallery) {
                    deterministicMediaReply = 'Here are the most relevant images, videos, and articles I found. Open any item in the gallery below to view it.';
                  }
                } else if (wantsOnlyMediaGallery) {
                  deterministicMediaReply = "I couldn't find relevant embeddable media for this search this time.";
                }
              }
              if (!wantsMediaGallery && shouldUseVisualAnchor && (realVideos.length || realImages.length)) {
                mediaForMessage = { videos: realVideos, images: realImages, query: mediaQueryForMessage };
              }
              if (!wantsMediaGallery && shouldAttachRelatedMedia && realImages.length) {
                mediaForMessage = {
                  videos: [],
                  images: realImages,
                  query: mediaQueryForMessage,
                };
              }
              if (searchData.results?.length) {
                groundingSearchData = searchData;
                groundingSearchQuery = searchData.searchMeta?.queryUsed || searchQuery;
                groundingFreshnessRequested = freshnessRequested;
                const snippets = searchData.results
                  .map((r, i) => `[${i + 1}] ${r.title}${r.publishedAt ? `\nPublished: ${r.publishedAt}` : '\nPublished: date unavailable'}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                const contextBlock = recentContextAnchor
                  ? `\nConversation context anchor from previous turns: "${recentContextAnchor}"`
                  : '';
                const freshnessRules = freshnessRequested
                  ? `\n- FRESHNESS IS MANDATORY: The user requested latest/current information. The host has ranked the evidence newest-first and limited it to the freshest retrieved cohort.\n- Use ONLY the newest relevant retrieved facts. Prefer the greatest Published timestamp. Ignore older claims when a newer source updates, supersedes, or conflicts with them.\n- State the exact date of the newest evidence you rely on. If every result says "date unavailable", say that recency could not be independently confirmed instead of presenting it as definitively latest.`
                  : '';
                userContent = `${content}${recentConversationContextBlock}${sharedProjectContextBlock ? `\n\n${sharedProjectContextBlock}` : ''}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${searchData.freshness?.retrievedAt || new Date().toISOString()}) ===\nSearch query used: "${searchQuery}"${contextBlock}\nFreshness requested: ${freshnessRequested ? 'yes' : 'no'}\nNewest dated result: ${searchData.freshness?.newestPublishedAt || 'date unavailable'}\n\n${snippets}\n=== END SEARCH DATA ===${mediaBlock}\n\nUSAGE RULES:\n- These results are LIVE data fetched right now from the internet — your training cutoff does NOT apply here.${freshnessRules}\n- Treat project conversations, document digests, image analyses, current-chat context, and live web evidence as distinct sources of truth. Use all relevant sources.\n- Project context is first-party product knowledge. Never discard it merely because public search is sparse or absent. If web evidence conflicts with project material, state the discrepancy instead of silently choosing one.\n- Read every source title and snippet before answering. If multiple titles/snippets directly name the user's entity, the search succeeded: synthesize the evidence and do not claim nothing was found.\n- Start with a polished direct explanation. Add only the most useful supporting facts; avoid filler introductions and repetitive bullets.\n- Conversation context comes FIRST. Resolve pronouns and phrases like "this device", "that product", "it", or "the company" from the conversation context anchor before interpreting search results.\n- If the search results clearly do not match the entity the user is referring to in this conversation, IGNORE the search results and answer from project context, prior turns, or reliable knowledge instead. Do NOT pivot to an unrelated topic just because it appeared in the search results.\n- If the user asks who makes, produces, owns, founded, launched, or sells the referenced thing, search results are required evidence when available. Do not say you need more details when project or conversation context already names the referenced thing.\n- Do not print numeric source markers such as [1] or [1, 2]. The host preserves source provenance separately.\n- MEDIA RULES (strict, NON-NEGOTIABLE):\n   • NEVER write or paste any YouTube, Instagram, Twitter/X, TikTok, or article URL as text or as a markdown link in your reply. The UI renders verified media separately.\n   • NEVER invent video titles, image descriptions, durations, channel names, view counts, or URLs. If you do not have a verified value, omit it.\n   • The UI auto-renders an embedded video player + image gallery directly under your reply for every item in the MEDIA GALLERY block. Do NOT enumerate them.\n   • When the user asks for "videos", "images", "more media", "social posts", or similar, reply with ONE short sentence pointing at the gallery and stop.\n   • If the MEDIA GALLERY block is empty, say plainly that you couldn't find relevant media this time. Do NOT invent placeholder links to fill the gap.\n\nAnswer:`;
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
                userContent = `${content}${recentConversationContextBlock}${sharedProjectContextBlock ? `\n\n${sharedProjectContextBlock}` : ''}\n\n[Web search returned no useful public results.${sharedProjectContextBlock ? ' The project context above remains first-party source material: answer from it directly and do not request another search.' : mediaBlock ? ' A related media gallery is rendered below; reference it briefly without inventing links.' : ' Answer from conversation context and reliable knowledge; note your cutoff date if relevant.'}]${contextNote}${mediaBlock}`;
              }
              if (visualSearchAnchor) {
                userContent = userContent
                  .replace(`Search query used: "${searchQuery}"`, `Search query used: "${searchQuery}"\nImage-derived search anchor: "${visualSearchAnchor}"`)
                  .replace('- Do not print numeric source markers such as [1] or [1, 2]. The host preserves source provenance separately.', '- For image identity / object matching, only identify a person, product, place, or device when the source title/snippet clearly matches visible text, logo, distinctive object details, or the image-derived anchor. If the match is weak, say you could not verify it from the web results.\n- Do not print numeric source markers; the host preserves source provenance separately.');
              }
              if (realVideos.length || realImages.length || realArticles.length) {
                if (shouldAttachRelatedMedia) {
                  mediaForMessage = {
                    videos: realVideos,
                    images: realImages,
                    articles: realArticles,
                    query: mediaQueryForMessage,
                  };
                }
              }
            } catch (e) {
              console.warn('Web search failed:', e.message);
            } finally {
              if (isCurrentRun()) setIsSearching(false);
            }
          }

          if (visionAnalysisBlock) {
            userContent = `${userContent}${visionAnalysisBlock}`;
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
            userContent = `${userContent}${previousPromptContext}\n\nIMAGE GENERATION REQUEST: Return exactly one line in the form [IMAGE_GEN: ...]. Do not add any explanation, commentary, markdown, or extra text. Preserve every user-provided subject, exact count, attribute, relationship, action, visible text and spelling, color, style, camera/composition detail, background, aspect ratio, exclusion, and negative constraint. Only add compatible visual detail; never replace, summarize away, reinterpret, or contradict a supplied detail. The prompt inside the marker should be detailed, structured, and ready for image generation.`;
          }

          if (wantsVideoGeneration) {
            const previousVideoPromptContext = wantsVideoRefinementFollowup && previousVideoPrompt
              ? `\n\nPREVIOUS GENERATED VIDEO PROMPT (use as base context): "${previousVideoPrompt}".\nThe current user message is a refinement request for that video. Keep the core scene, then apply only the user's requested corrections.`
              : '';
            userContent = `${userContent}${previousVideoPromptContext}\n\nVIDEO GENERATION REQUEST: Return exactly one line in the form [VIDEO_GEN: ...]. Do not add any explanation, commentary, markdown, or extra text. The prompt inside the marker should be concise, cinematic, and ready for video generation.`;
          }

          if (hasImages && !wantsImageGeneration && !wantsVideoGeneration) {
            userContent = `${userContent}\n\nIMAGE ATTACHMENT NOTE: This current message includes ${imageAttachments.length} image attachment${imageAttachments.length === 1 ? '' : 's'}. Answer from the verified image-analysis block and use any provided web-search data only as supporting evidence.`;
          }

          if (deterministicMediaReply) {
            if (!isCurrentRun()) return;
            await updateMessage(convId, assistantMsgId, {
              content: deterministicMediaReply,
              isStreaming: false,
              ...(mediaForMessage ? { media: mediaForMessage } : {}),
            });
            if (isNewChat) {
              generateSmartTitle(content, deterministicMediaReply).then((title) => {
                persistConversationUpdate(convId, { title });
              });
            }
            refreshConversationTitle(convId, [
              ...historySource,
              { role: 'user', content },
              { role: 'assistant', content: deterministicMediaReply },
            ]).catch(() => {});
            await persistProjectTurn(deterministicMediaReply);
            await persistWorkspaceTurn(deterministicMediaReply);
            return;
          }

          history.push({ role: 'user', content: userContent });

          const taskRequiresResearch = agentTaskRequiresResearch(content, Boolean(
            webSearch
            || engineResult.needsSearch
            || retrievalPolicy.searchPriority
            || groundingSearchData
            || needsFreshInformation(content)
          ));

          const autoTaskCall = !desktopWorkspaceRequest.active && shouldRunAgentTask({
            text: content,
            complexity: engineResult.classification?.complexity || 'low',
            requiresResearch: taskRequiresResearch,
            simpleGreeting,
            mediaIntent: Boolean(wantsImageGeneration || wantsVideoGeneration || wantsOnlyMediaGallery),
            websiteInspection: Boolean(websiteInspectionRequest),
          }) ? {
            name: TOOL_NAMES.TASK,
            arguments: { goal: content },
          } : null;

          // Raw image bytes stay on the dedicated vision route. The chat model
          // receives only the verified textual analysis above.
          const images = [];
          if (!isCurrentRun()) return;

          let fullText = '';
          let finalThinkingText = '';
          let requestFailed = false;
          let requestAborted = false;
          let requestedWebSearchQuery = '';
          let requestedBrowserInspection = null;
          let requestedToolCall = websiteInspectionRequest
            || (desktopWorkspaceRequest.active
              ? { name: AGENT_CAPABILITIES.FILE_LIST, arguments: { path: '' } }
              : autoTaskCall);

          // ── Response cache check ──
          const cacheKey = makeCacheKey({
            messages: history,
            images,
          });
          const cached = cacheKey ? getCachedResponse(cacheKey) : null;
          if (desktopWorkspaceRequest.active && isCurrentRun()) {
            const workflowSteps = buildDesktopWorkflowSteps(content, desktopWorkspaceRequest);
            setTaskWorkflow({
              id: `${convId || 'conversation'}:${runId}`,
              runId,
              goal: content.trim(),
              phase: 'executing',
              status: 'running',
              currentStep: 0,
              steps: workflowSteps,
              startedAt: Date.now(),
              updatedAt: Date.now(),
            });
          } else if (autoTaskCall && isCurrentRun()) {
            setTaskWorkflow({
              id: `${convId || 'conversation'}:${runId}`,
              runId,
              goal: content.trim(),
              phase: 'planning',
              status: 'running',
              steps: [],
              startedAt: Date.now(),
              updatedAt: Date.now(),
            });
            diagnosticLog('tool', 'automatic task workflow started', {
              runId,
              complexity: engineResult.classification?.complexity || 'low',
              research: taskRequiresResearch,
            });
          } else if (desktopWorkspaceRequest.active) {
            // Desktop work starts with deterministic local inspection. Waiting
            // for the model before the first tool made a busy server prevent
            // the agent from touching the workspace at all.
            fullText = '';
            setIsSearching(false);
          } else if (cached && isCurrentRun()) {
            fullText = humanizeAssistantText(cached);
            setStreamingContent(fullText);
            setIsSearching(false);
          } else {
          try {
            let firstChunkSeen = false;
            await sendChatMessage(
              history,
              (accumulated) => {
                if (!isCurrentRun()) return;
                const controlRequest = extractWebSearchRequest(accumulated);
                const browserRequest = extractBrowserRequest(accumulated);
                const toolCall = extractToolCall(accumulated);
                if (toolCall) {
                  requestedToolCall = toolCall;
                  if (toolCall.name === TOOL_NAMES.WEB_SEARCH && toolCall.arguments?.query) {
                    requestedWebSearchQuery = String(toolCall.arguments.query);
                    setIsSearching(true);
                  }
                  if (toolCall.name === TOOL_NAMES.BROWSER_INSPECT) {
                    requestedBrowserInspection = toLegacyBrowserRequest(toolCall);
                  }
                  diagnosticLog('tool', 'model requested host tool', {
                    runId,
                    tool: toolCall.name,
                  });
                }
                if (browserRequest) {
                  requestedBrowserInspection = browserRequest;
                  diagnosticLog('browser', 'model requested Chrome MCP inspection', {
                    runId,
                    url: browserRequest.url,
                    task: browserRequest.task,
                  });
                }
                if (controlRequest?.query) {
                  if (requestedWebSearchQuery !== controlRequest.query) {
                    diagnosticLog('search', 'model requested web search', {
                      runId,
                      query: String(controlRequest.query).slice(0, 180),
                    });
                  }
                  requestedWebSearchQuery = controlRequest.query;
                  setIsSearching(true);
                }
                const controlPending = isPotentialToolControl(accumulated) || isPotentialWebSearchControl(accumulated) || isPotentialBrowserControl(accumulated);
                const hasHiddenControl = Boolean(controlRequest || browserRequest || toolCall || controlPending);
                const visibleText = hasHiddenControl ? '' : stripAllControlText(accumulated);
                if (!firstChunkSeen && visibleText && !controlRequest && !browserRequest && !toolCall) { firstChunkSeen = true; setIsSearching(false); }
                fullText = accumulated;
                flushStreamingContent(visibleText);
                if (options.voice && visibleText && !isToolNarration(visibleText)) {
                  options.onResponseChunk?.(visibleText, { final: false });
                }
              },
              images,
              {
                desktopCoding: desktopWorkspaceRequest.active,
                think: shouldThink,
                tools: responseModelTools,
                voice: Boolean(options.voice),
                onThinking: (accumulated) => {
                  if (!isCurrentRun()) return;
                  const thinkingControlRequest = extractWebSearchRequest(accumulated);
                  const thinkingBrowserRequest = extractBrowserRequest(accumulated);
                  const thinkingToolCall = extractToolCall(accumulated);
                  if (thinkingToolCall) {
                    requestedToolCall = thinkingToolCall;
                    if (thinkingToolCall.name === TOOL_NAMES.WEB_SEARCH && thinkingToolCall.arguments?.query) {
                      requestedWebSearchQuery = String(thinkingToolCall.arguments.query);
                      setIsSearching(true);
                    }
                    if (thinkingToolCall.name === TOOL_NAMES.BROWSER_INSPECT) {
                      requestedBrowserInspection = toLegacyBrowserRequest(thinkingToolCall);
                    }
                  }
                  if (thinkingBrowserRequest) {
                    requestedBrowserInspection = thinkingBrowserRequest;
                    diagnosticLog('browser', 'model requested Chrome MCP inspection from thinking', {
                      runId,
                      url: thinkingBrowserRequest.url,
                    });
                  }
                  if (thinkingControlRequest?.query) {
                    if (requestedWebSearchQuery !== thinkingControlRequest.query) {
                      diagnosticLog('search', 'model requested web search from thinking', {
                        runId,
                        query: String(thinkingControlRequest.query).slice(0, 180),
                      });
                    }
                    requestedWebSearchQuery = thinkingControlRequest.query;
                    setIsSearching(true);
                  }
                  finalThinkingText = stripAllControlText(accumulated);
                  const visibleThinking = finalThinkingText;
                  if (!firstChunkSeen && visibleThinking) { firstChunkSeen = true; setIsSearching(false); }
                  flushThinkingContent(visibleThinking);
                },
              },
            );
          } catch (err) {
            if (err?.name === 'AbortError') {
              requestAborted = true;
            } else if (requestedWebSearchQuery) {
              // A model may emit only the web-search control marker in its
              // private reasoning channel. That is a successful tool request,
              // not an empty-answer failure.
              requestFailed = false;
              fullText = `[WEB_SEARCH: ${requestedWebSearchQuery}]`;
            } else if (groundingSearchData?.results?.length) {
              requestFailed = false;
              const timedOut = isChatTimeoutError(err);
              diagnosticWarn('search', timedOut
                ? 'model timed out after retrieval; using evidence fallback'
                : 'model failed after retrieval; retrying grounded synthesis', {
                runId,
                query: String(groundingSearchQuery || content).slice(0, 180),
                resultCount: groundingSearchData.results.length,
                error: err?.message || 'Unknown generation error',
              });
              cancelPendingStreamFlushes();
              setStreamingContent('');
              setThinkingContent('');
              if (timedOut) {
                fullText = buildEvidenceFallbackAnswer(
                  groundingSearchData,
                  groundingSearchQuery || content,
                );
              } else {
                try {
                  const retryHistory = history.map((message, index) => (
                    index === history.length - 1 && message.role === 'user'
                      ? {
                        ...message,
                        content: `${message.content}\n\nSYNTHESIS RETRY: Study the supplied search evidence, then answer the original question in your own words. Start with a simple direct summary, synthesize facts instead of copying snippets, and do not expose raw search payloads, HTML, internal controls, or tool arguments.`,
                      }
                      : message
                  ));
                  let groundedRetry = '';
                  await sendChatMessage(
                    retryHistory,
                    (accumulated) => {
                      if (!isCurrentRun()) return;
                      groundedRetry = stripAllControlText(accumulated);
                      flushStreamingContent(groundedRetry);
                    },
                    images,
                    {
                      desktopCoding: desktopWorkspaceRequest.active,
                      think: false,
                      tools: [],
                    },
                  );
                  fullText = groundedRetry.trim() || buildEvidenceFallbackAnswer(
                    groundingSearchData,
                    groundingSearchQuery || content,
                  );
                } catch (retryError) {
                  fullText = buildEvidenceFallbackAnswer(
                    groundingSearchData,
                    groundingSearchQuery || content,
                  );
                  diagnosticWarn('search', 'grounded synthesis retry failed; using concise fallback', {
                    runId,
                    query: String(groundingSearchQuery || content).slice(0, 180),
                    error: retryError?.message || 'Unknown generation error',
                  });
                }
              }
            } else {
              requestFailed = true;
              fullText = fullText || `Sorry, something went wrong: ${err.message}`;
            }
          }
          // Cache successful responses
          if (
            cacheKey
            && fullText
            && !requestFailed
            && !requestAborted
            && !extractWebSearchRequest(fullText)
            && !extractToolCall(fullText)
            && !indicatesKnowledgeGap(fullText)
          ) {
            setCachedResponse(cacheKey, fullText);
          }
          }

          if (requestAborted || !isCurrentRun()) {
            return;
          }

          const proposedToolCall = requestedToolCall || extractToolCall(fullText);
          const disallowedMediaTool = (
            proposedToolCall?.name === TOOL_NAMES.IMAGE && !wantsImageGeneration
          ) || (
            proposedToolCall?.name === TOOL_NAMES.VIDEO && !wantsVideoGeneration
          );
          if (disallowedMediaTool) {
            diagnosticWarn('tool', 'ignored media tool without current-turn media intent', {
              runId,
              tool: proposedToolCall.name,
            });
            const visibleAnswer = stripAllControlText(fullText);
            if (visibleAnswer.trim()) {
              fullText = visibleAnswer;
            } else if (!requestFailed && isCurrentRun()) {
              const textOnlyHistory = history.map((message, index) => (
                index === history.length - 1 && message.role === 'user'
                  ? {
                    ...message,
                    content: `${message.content}\n\nTEXT-ONLY CORRECTION: Answer this current request directly in text. Do not call image or video generation and do not continue a prior media task.`,
                  }
                  : message
              ));
              let recoveredText = '';
              try {
                await sendChatMessage(
                  textOnlyHistory,
                  (accumulated) => {
                    if (!isCurrentRun()) return;
                    recoveredText = stripAllControlText(accumulated);
                    flushStreamingContent(recoveredText);
                  },
                  images,
                  {
                    desktopCoding: desktopWorkspaceRequest.active,
                    think: shouldThink,
                    tools: responseModelTools,
                  },
                );
                if (recoveredText.trim()) fullText = recoveredText.trim();
              } catch (recoveryError) {
                console.warn('Text-only media correction failed:', recoveryError?.message);
              }
            }
          }
          const finalToolCall = disallowedMediaTool ? null : proposedToolCall;
          const browserInspection = requestedBrowserInspection
            || toLegacyBrowserRequest(finalToolCall)
            || extractBrowserRequest(fullText);
          if (browserInspection && !requestFailed && isCurrentRun()) {
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            try {
              const documentation = await requestBrowserDocumentation(browserInspection);
              if (!isCurrentRun()) return;
              const documentationBlock = formatBrowserDocumentation(documentation);
              history[history.length - 1] = {
                role: 'user',
                content: `${content}\n\n${documentationBlock}\n\nUse this captured website documentation to complete the user's request. Distinguish visible page facts from your own inferences. Do not claim access to anything outside the supplied capture.`,
              };
              let inspectedAnswer = '';
              await sendChatMessage(
                history,
                (accumulated) => {
                  if (!isCurrentRun()) return;
                  inspectedAnswer = stripAllControlText(accumulated);
                  flushStreamingContent(inspectedAnswer);
                },
                images,
                {
                  desktopCoding: desktopWorkspaceRequest.active,
                  think: shouldThink,
                  tools: responseModelTools,
                  onThinking: (accumulated) => {
                    if (!isCurrentRun()) return;
                    finalThinkingText = stripAllControlText(accumulated);
                    flushThinkingContent(finalThinkingText);
                  },
                },
              );
              fullText = inspectedAnswer;
            } catch (browserError) {
              const denied = /not approved/i.test(browserError?.message || '');
              fullText = denied
                ? 'I did not inspect the website because browser access was not approved.'
                : `I could not inspect the website because the Chrome MCP connector is unavailable: ${browserError.message}`;
            }
          }

          if (finalToolCall && DESKTOP_TOOL_NAMES.has(finalToolCall.name) && !requestFailed && isCurrentRun()) {
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            const agentHistory = [...history];
            const executedCalls = [];
            const successfulCalls = [];
            const desktopToolResults = [];
            const desktopActivities = [];
            const publishDesktopActivities = () => {
              finalThinkingText = `[Agent activity]\n${desktopActivities.join('\n')}`;
              flushThinkingContent(finalThinkingText);
            };
            let changesSinceValidation = false;
            let validationFailures = [];
            const pendingDeterministicCalls = extractWorkspaceFileReferences(content).map((path) => ({
              name: AGENT_CAPABILITIES.FILE_READ,
              arguments: { path },
            }));
            pendingDeterministicCalls.unshift(
              { name: AGENT_CAPABILITIES.WORKSPACE_INDEX, arguments: {} },
              { name: AGENT_CAPABILITIES.WORKSPACE_SEARCH, arguments: { query: content, limit: 8 } },
            );
            if (desktopWorkspaceRequest.serverStart) {
              pendingDeterministicCalls.push({ name: AGENT_CAPABILITIES.WORKSPACE_START, arguments: {} });
            }
            let currentCall = finalToolCall;
            let desktopAnswer = '';
            try {
              for (let round = 0; round < MAX_DESKTOP_AGENT_ROUNDS && currentCall; round += 1) {
                if (!isCurrentRun()) return;
                const stepTitle = desktopToolTitle(currentCall);
                const workflowStage = desktopWorkflowStageForTool(currentCall.name);
                setTaskWorkflow((current) => current?.runId === runId ? {
                  ...current,
                  phase: 'executing',
                  status: 'running',
                  updatedAt: Date.now(),
                  currentStep: Math.max(0, (current.steps || []).findIndex((step) => step.stage === workflowStage)),
                  steps: (current.steps || []).map((step) => (
                    step.stage === workflowStage
                      ? { ...step, instruction: stepTitle, status: 'running', result: '' }
                      : step.status === 'running' ? { ...step, status: 'done' } : step
                  )),
                } : current);

                const completedCall = currentCall;
                const activityIndex = desktopActivities.push(desktopToolActivity(completedCall)) - 1;
                publishDesktopActivities();
                let toolResult = '';
                let toolError = null;
                try {
                  toolResult = await executeHostTool(completedCall);
                  successfulCalls.push(completedCall.name);
                } catch (error) {
                  toolError = error;
                  toolResult = `ERROR: ${error?.message || 'The desktop operation failed.'}`;
                }
                executedCalls.push(completedCall.name);
                desktopToolResults.push({
                  name: completedCall.name,
                  result: String(toolResult || ''),
                  ok: !toolError,
                });
                desktopActivities[activityIndex] = desktopToolActivity(
                  completedCall,
                  toolError ? 'error' : 'done',
                  toolResult,
                );
                if (!toolError) {
                  const changeSummary = desktopChangeSummary(completedCall, toolResult);
                  if (changeSummary) workspaceChangesForMessage = [...workspaceChangesForMessage, changeSummary];
                }
                publishDesktopActivities();
                setTaskWorkflow((current) => current?.runId === runId ? {
                  ...current,
                  updatedAt: Date.now(),
                  steps: (current.steps || []).map((step) => (
                    step.stage === workflowStage
                      ? { ...step, status: toolError ? 'error' : 'done', result: toolError ? toolResult : 'Completed' }
                      : step
                  )),
                } : current);

                if ([AGENT_CAPABILITIES.FILE_WRITE, AGENT_CAPABILITIES.FILE_REPLACE].includes(completedCall.name) && !toolError) {
                  changesSinceValidation = true;
                  validationFailures = [];
                }
                if ([AGENT_CAPABILITIES.TEST_RUN, AGENT_CAPABILITIES.WORKSPACE_VALIDATE].includes(completedCall.name) && toolError) {
                  validationFailures.push(toolResult);
                }

                agentHistory.push({
                  role: 'user',
                  content: [
                    `=== DESKTOP TOOL RESULT: ${completedCall.name} ===`,
                    String(toolResult || '').slice(0, MAX_DESKTOP_TOOL_RESULT_CHARS),
                    '=== END DESKTOP TOOL RESULT ===',
                    toolError
                      ? 'The operation failed. Diagnose the actual error, make any necessary correction, and retry or choose a better tool. Do not claim success.'
                      : 'Continue the original workspace request now. Call the next required desktop tool, or give the final answer only when the requested work and validation are complete.',
                  ].join('\n'),
                });

                if ([AGENT_CAPABILITIES.FILE_WRITE, AGENT_CAPABILITIES.FILE_REPLACE].includes(completedCall.name)
                  && !toolError
                  && !pendingDeterministicCalls.some((call) => call.name === AGENT_CAPABILITIES.GIT_DIFF)) {
                  pendingDeterministicCalls.push({ name: AGENT_CAPABILITIES.GIT_DIFF, arguments: {} });
                }

                if (pendingDeterministicCalls.length) {
                  currentCall = pendingDeterministicCalls.shift();
                  desktopAnswer = '';
                  continue;
                }

                currentCall = null;
                for (let reminder = 0; reminder < MAX_DESKTOP_AGENT_REMINDERS; reminder += 1) {
                  let nextToolCall = null;
                  let continuation = '';
                  let continuationError = null;
                  for (let attempt = 0; attempt < 3; attempt += 1) {
                    nextToolCall = null;
                    continuation = '';
                    try {
                      await sendChatMessage(
                        agentHistory,
                        (accumulated) => {
                          if (!isCurrentRun()) return;
                          nextToolCall = extractToolCall(accumulated) || nextToolCall;
                          continuation = stripAllControlText(accumulated);
                          flushStreamingContent(continuation);
                        },
                        images,
                        {
                          desktopCoding: true,
                          think: shouldThink,
                          tools: responseModelTools,
                          // Keep the chat's live work log focused on concrete
                          // operations and diffs rather than private model
                          // reasoning.
                          onThinking: () => {
                            if (isCurrentRun()) publishDesktopActivities();
                          },
                        },
                      );
                      continuationError = null;
                      break;
                    } catch (error) {
                      continuationError = error;
                      if (error?.name === 'AbortError' || attempt === 2 || !isCurrentRun()) throw error;
                      diagnosticWarn('tool', 'desktop agent continuation failed; retrying', {
                        runId,
                        attempt: attempt + 1,
                        error: error?.message || 'unknown error',
                      });
                      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                    }
                  }
                  if (continuationError) throw continuationError;

                  if (nextToolCall && DESKTOP_TOOL_NAMES.has(nextToolCall.name)) {
                    currentCall = nextToolCall;
                    desktopAnswer = '';
                    break;
                  }

                  if (desktopWorkspaceRequest.mutation && changesSinceValidation) {
                    cancelPendingStreamFlushes();
                    setStreamingContent('');
                    setThinkingContent('');
                    pendingDeterministicCalls.push(...buildRegressionValidationCalls());
                    changesSinceValidation = false;
                    validationFailures = [];
                    currentCall = pendingDeterministicCalls.shift();
                    desktopAnswer = '';
                    break;
                  }

                  const incomplete = desktopGoalNeedsMoreWork({
                    request: desktopWorkspaceRequest,
                    successfulCalls,
                    validationFailures,
                  });
                  desktopAnswer = continuation.trim();
                  if ((!incomplete.inspection && !incomplete.mutation && !incomplete.execution && !incomplete.validation)
                    || reminder === MAX_DESKTOP_AGENT_REMINDERS - 1) break;
                  agentHistory.push({
                    role: 'user',
                    content: incomplete.validation
                      ? 'Regression validation failed. Inspect the failure, fix the code, and rerun the relevant validation before answering.'
                      : incomplete.mutation
                      ? 'You have not implemented the requested change yet. Continue with the appropriate filesystem inspection and write tools. Do not answer with intentions or recommendations.'
                      : incomplete.execution
                        ? 'The user asked you to execute work, but no workspace command has run. Call shell.run or test.run now and use the actual terminal result.'
                        : 'You have only listed filenames. Read or search representative source and configuration files before answering. Respond with the next desktop tool call.',
                  });
                }
              }

              if (currentCall) throw new Error('The desktop agent reached its operation limit before finishing.');
              if (!desktopAnswer.trim()) throw new Error('The desktop agent completed tools but returned no final response.');
              fullText = desktopAnswer;
              setTaskWorkflow((current) => current?.runId === runId ? {
                ...current,
                phase: 'completed',
                status: 'completed',
                updatedAt: Date.now(),
                steps: (current.steps || []).map((step) => (
                  step.status === 'running' || step.status === 'pending'
                    ? { ...step, status: 'done' }
                    : step
                )),
              } : current);
            } catch (desktopError) {
              setTaskWorkflow((current) => current?.runId === runId ? {
                ...current,
                phase: 'error',
                status: 'error',
                error: desktopError.message,
                updatedAt: Date.now(),
                steps: (current.steps || []).map((step) => (
                  step.status === 'running' ? { ...step, status: 'error', result: desktopError.message } : step
                )),
              } : current);
              const completedSteps = executedCalls.length;
              if (completedSteps) {
                if (desktopWorkspaceRequest.serverStart
                  && successfulCalls.includes(AGENT_CAPABILITIES.WORKSPACE_START)) {
                  fullText = 'The development server is running in the in-app terminal. Its live output and local preview link will appear there.';
                } else try {
                  fullText = await requestWorkspaceSynthesis({
                    request: content,
                    toolResults: desktopToolResults,
                  });
                  setTaskWorkflow((current) => current?.runId === runId ? {
                    ...current,
                    phase: 'completed',
                    status: 'completed',
                    error: '',
                    updatedAt: Date.now(),
                  } : current);
                } catch (fallbackError) {
                  diagnosticWarn('tool', 'remote workspace synthesis unavailable; using local evidence summary', {
                    runId,
                    primaryError: desktopError?.message || 'unknown error',
                    fallbackError: fallbackError?.message || 'unknown error',
                  });
                  fullText = buildLocalWorkspaceSummary(content, desktopToolResults);
                }
                setTaskWorkflow((current) => current?.runId === runId ? {
                  ...current,
                  phase: 'completed',
                  status: 'completed',
                  error: '',
                  updatedAt: Date.now(),
                  steps: (current.steps || []).map((step) => (
                    step.status === 'running' || step.status === 'pending' || step.status === 'error'
                      ? { ...step, status: 'done', result: step.result || 'Completed locally' }
                      : step
                  )),
                } : current);
              } else {
                fullText = 'I could not access the selected workspace. Reopen the folder and try again.';
              }
            }
          }

          const inlineToolNames = new Set([
            TOOL_NAMES.CALCULATOR,
            TOOL_NAMES.WEATHER,
            TOOL_NAMES.CURRENCY,
            TOOL_NAMES.CODE,
            TOOL_NAMES.TASK,
            TOOL_NAMES.FILE_READ,
            TOOL_NAMES.FILE_WRITE,
            TOOL_NAMES.FILE_SEARCH,
            TOOL_NAMES.SHELL_RUN,
            TOOL_NAMES.TEST_RUN,
            TOOL_NAMES.GIT_STATUS,
            TOOL_NAMES.GIT_DIFF,
          ]);
          if (finalToolCall && !DESKTOP_TOOL_NAMES.has(finalToolCall.name) && inlineToolNames.has(finalToolCall.name) && !requestFailed && isCurrentRun()) {
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            try {
              const toolResult = await executeHostTool(finalToolCall, {
                runTask: async (goal) => {
                  if (!goal) throw new Error('A task goal is required.');
                  setTaskWorkflow((current) => (
                    current?.runId === runId
                      ? current
                      : {
                        id: `${convId || 'conversation'}:${runId}`,
                        runId,
                        goal: String(goal).trim(),
                        phase: 'planning',
                        status: 'running',
                        steps: [],
                        startedAt: Date.now(),
                        updatedAt: Date.now(),
                      }
                  ));
                  const generate = async (prompt, generationOptions = {}) => {
                    if (!isCurrentRun()) {
                      const cancelled = new Error('Task workflow was stopped.');
                      cancelled.name = 'AbortError';
                      throw cancelled;
                    }
                    let result = '';
                    await sendChatMessage(
                      [{ role: 'user', content: prompt }],
                      (accumulated) => { result = stripAllControlText(accumulated); },
                      [],
                      {
                        desktopCoding: desktopWorkspaceRequest.active,
                        think: generationOptions.think ?? true,
                        maxTokens: generationOptions.maxTokens,
                        tools: [],
                        systemPrompt: 'You are an internal planning and execution worker. Complete only the requested private phase. Never call or mention tools, never emit control markers, and never address the end user.',
                      },
                    );
                    if (!isCurrentRun()) {
                      const cancelled = new Error('Task workflow was stopped.');
                      cancelled.name = 'AbortError';
                      throw cancelled;
                    }
                    if (!result.trim()) throw new Error('The task step returned no result.');
                    return result.trim();
                  };
                  return await runAgentTask({
                    goal,
                    context: [
                      latestConversationSubject
                        ? `Recent subject anchor: ${latestConversationSubject}`
                        : '',
                      buildRecentConversationContext(historySource),
                    ].filter(Boolean).join('\n'),
                    requiresResearch: agentTaskRequiresResearch(goal, taskRequiresResearch),
                    freshness: needsFreshInformation(content),
                    generate,
                    search: async (query, { freshness }) => {
                      if (!isCurrentRun()) {
                        const cancelled = new Error('Task workflow was stopped.');
                        cancelled.name = 'AbortError';
                        throw cancelled;
                      }
                      return searchWeb({
                        query,
                        anchor: query,
                        strictAnchor: false,
                        freshness,
                        includeMedia: false,
                        requireTextResults: true,
                      }, {
                        attemptsPerQuery: 2,
                        retryEmpty: true,
                      });
                    },
                    onPhase: (phase) => {
                      diagnosticLog('tool', 'task workflow progress', { runId, ...phase });
                      if (!isCurrentRun()) return;
                      setTaskWorkflow((current) => (
                        current?.runId === runId ? applyTaskWorkflowPhase(current, phase) : current
                      ));
                    },
                  });
                },
              });
              const isTaskResult = finalToolCall.name === TOOL_NAMES.TASK;
              if (isTaskResult && isCurrentRun()) {
                setTaskWorkflow((current) => (
                  current?.runId === runId
                    ? { ...current, phase: 'responding', status: 'running', updatedAt: Date.now() }
                    : current
                ));
              }
              history[history.length - 1] = {
                role: 'user',
                content: isTaskResult
                  ? `${content}\n\n=== COMPLETED INTERNAL WORK ===\n${toolResult}\n=== END COMPLETED INTERNAL WORK ===\n\nGive the user one complete final answer now. Do not mention planning, steps, task runners, tools, or internal reasoning, and do not start another workflow.`
                  : `${content}\n\n=== TOOL RESULT ===\n${toolResult}\n=== END TOOL RESULT ===\n\nContinue the original request using this result. Do not emit the same tool call again.`,
              };
              let continuedAnswer = '';
              try {
                await sendChatMessage(
                  history,
                  (accumulated) => {
                    if (!isCurrentRun()) return;
                    continuedAnswer = stripAllControlText(accumulated);
                    flushStreamingContent(continuedAnswer);
                  },
                  images,
                  {
                    desktopCoding: desktopWorkspaceRequest.active,
                    think: shouldThink,
                    tools: isTaskResult
                      ? []
                      : responseModelTools.filter((tool) => tool?.function?.name !== finalToolCall.name),
                    onThinking: (accumulated) => {
                      if (!isCurrentRun()) return;
                      finalThinkingText = stripAllControlText(accumulated);
                      flushThinkingContent(finalThinkingText);
                    },
                  },
                );
                if (!continuedAnswer.trim()) throw new Error('The final task response was empty.');
                fullText = continuedAnswer;
              } catch (responseError) {
                const taskFallback = isTaskResult ? extractAgentTaskFallback(toolResult) : '';
                if (!taskFallback) throw responseError;
                diagnosticWarn('tool', 'final task synthesis failed; using completed task data', {
                  runId,
                  error: responseError?.message || 'Empty final response',
                });
                continuedAnswer = taskFallback;
                fullText = taskFallback;
                flushStreamingContent(taskFallback);
              }
              if (isTaskResult && isCurrentRun()) {
                setTaskWorkflow((current) => (
                  current?.runId === runId
                    ? { ...current, phase: 'completed', status: 'completed', updatedAt: Date.now() }
                    : current
                ));
              }
            } catch (toolError) {
              if (finalToolCall.name === TOOL_NAMES.TASK && isCurrentRun()) {
                setTaskWorkflow((current) => (
                  current?.runId === runId
                    ? {
                      ...current,
                      phase: 'error',
                      status: 'error',
                      error: toolError.message,
                      updatedAt: Date.now(),
                    }
                    : current
                ));
              }
              fullText = `I couldn't complete that operation: ${toolError.message}`;
            }
          }

          if (finalToolCall?.name === TOOL_NAMES.IMAGE && finalToolCall.arguments?.prompt) {
            wantsImageGeneration = true;
            fullText = `[IMAGE_GEN: ${String(finalToolCall.arguments.prompt).trim()}]`;
          } else if (finalToolCall?.name === TOOL_NAMES.VIDEO && finalToolCall.arguments?.prompt) {
            wantsVideoGeneration = true;
            fullText = `[VIDEO_GEN: ${String(finalToolCall.arguments.prompt).trim()}]`;
          }

          if (wantsImageGeneration && !requestFailed) {
            fullText = normalizeImageGenerationOutput(fullText, content, wantsImageRefinementFollowup ? previousImagePrompt : '');
            const imagePrompt = extractImageGenerationPrompt(fullText);
            if (imagePrompt && isCurrentRun()) {
              const generation = {
                mode: wantsImageRefinementFollowup ? 'edit' : 'generate',
                ...(wantsImageRefinementFollowup ? { referenceImage: previousImageReference } : {}),
              };
              generatedMediaForMessage = { generation };
              try {
                const persistedImage = await persistGeneratedImageAsset({
                  prompt: imagePrompt,
                  userId: user.uid,
                  conversationId: convId,
                  messageId: assistantMsgId,
                  allowNsfw: false,
                  referenceImage: wantsImageRefinementFollowup ? previousImageReference : '',
                });
                if (persistedImage?.url) {
                  generatedMediaForMessage = {
                    images: [persistedImage],
                    generation,
                  };
                }
              } catch (persistErr) {
                console.warn('Generated image persistence failed:', persistErr?.message);
              }
            }
          } else if (wantsVideoGeneration && !requestFailed) {
            fullText = normalizeVideoGenerationOutput(fullText, content, wantsVideoRefinementFollowup ? previousVideoPrompt : '');
          }

          // ── Model-driven fallback web search ──
          // Execute retrieval only after MIRA explicitly requests web.search.
          // Host-side confidence heuristics must never initiate a search.
          const explicitSearchRequest = extractWebSearchRequest(fullText);
          if (explicitSearchRequest?.query) {
            if (requestedWebSearchQuery !== explicitSearchRequest.query) {
              diagnosticLog('search', 'web-search control detected after generation', {
                runId,
                query: String(explicitSearchRequest.query).slice(0, 180),
              });
            }
            requestedWebSearchQuery = explicitSearchRequest.query;
          }

          // If the host already attached live evidence, a repeated search call
          // is a provider control mistake rather than a reason to browse twice.
          // Re-run synthesis once without tools so the user receives the actual
          // grounded answer and neither chat nor TTS exposes the control text.
          const requestedSearchAlreadyGrounded = Boolean(
            !requestFailed
            && requestedWebSearchQuery
            && groundingSearchData?.results?.length
            && normalizeSearchComparison(requestedWebSearchQuery) === normalizeSearchComparison(groundingSearchQuery),
          );
          if (requestedSearchAlreadyGrounded && isCurrentRun()) {
            diagnosticWarn('search', 'model repeated an already-completed search; regenerating from attached evidence', {
              runId,
              query: String(requestedWebSearchQuery).slice(0, 180),
            });
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            let groundedRetryText = '';
            try {
              await sendChatMessage(
                history,
                (accumulated) => {
                  if (!isCurrentRun()) return;
                  groundedRetryText = stripAllControlText(accumulated);
                  flushStreamingContent(groundedRetryText);
                },
                images,
                {
                  desktopCoding: desktopWorkspaceRequest.active,
                  think: false,
                  tools: [],
                  voice: Boolean(options.voice),
                },
              );
              if (groundedRetryText.trim()) fullText = groundedRetryText.trim();
            } catch (groundedRetryError) {
              diagnosticWarn('search', 'grounded control recovery failed; using evidence fallback', {
                runId,
                error: groundedRetryError?.message || 'Unknown grounded synthesis error',
              });
              fullText = buildEvidenceFallbackAnswer(groundingSearchData, groundingSearchQuery || content);
            }
            requestedWebSearchQuery = '';
            if (requestedToolCall?.name === TOOL_NAMES.WEB_SEARCH) requestedToolCall = null;
          }
          const autoSearchEligible =
            !requestFailed &&
            isCurrentRun() &&
            (
              !effectiveWebSearch
              || !groundingSearchData
              || (
                Boolean(requestedWebSearchQuery)
                && normalizeSearchComparison(requestedWebSearchQuery) !== normalizeSearchComparison(groundingSearchQuery)
              )
            ) &&
            !wantsImageGeneration &&
            !wantsVideoGeneration &&
            !requestedDocumentFormat &&
            !hasImages &&
            content.trim().length > 0 &&
            Boolean(requestedWebSearchQuery);

          const regenerateFromProjectContext = async (searchStatus) => {
            if (!sharedProjectContextBlock || !isCurrentRun()) return '';
            const projectHistory = history.slice(0, -1);
            projectHistory.push({
              role: 'user',
              content: `${content}\n\n${sharedProjectContextBlock}\n\nEXTERNAL VALIDATION STATUS: ${searchStatus}\nAnswer directly from the relevant project conversations, document digests, and image analyses above. These are first-party sources for this project. Do not request another web search and do not say information is unavailable when the project sources answer the question.`,
            });
            let projectAnswer = '';
            await sendChatMessage(
              projectHistory,
              (accumulated) => {
                if (!isCurrentRun()) return;
                projectAnswer = stripAllControlText(accumulated);
                flushStreamingContent(projectAnswer);
              },
              images,
              {
                desktopCoding: desktopWorkspaceRequest.active,
                think: shouldThink,
                tools: [],
                onThinking: (accumulated) => {
                  if (!isCurrentRun()) return;
                  finalThinkingText = stripAllControlText(accumulated);
                  flushThinkingContent(finalThinkingText);
                },
              },
            );
            return projectAnswer.trim();
          };

          if (autoSearchEligible) {
            diagnosticWarn('search', 'automatic fallback search activated', {
              runId,
              reason: 'model-control',
              query: String(requestedWebSearchQuery).slice(0, 180),
            });
            setIsSearching(true);
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            try {
              const fallbackQuery = await getLatestMessageSearchQuery(requestedWebSearchQuery)
                || buildContextualSearchQuery(content)
                || requestedWebSearchQuery
                || content;
              const fallbackFreshnessRequested = needsFreshInformation(content) || needsFreshInformation(fallbackQuery);
              const fallbackData = await searchWeb({
                query: fallbackQuery,
                includeMedia: true,
                freshness: fallbackFreshnessRequested,
              }, {
                attemptsPerQuery: 1,
                retryEmpty: true,
              });
              const fallbackResults = Array.isArray(fallbackData.results) ? fallbackData.results : [];

              if (fallbackResults.length && isCurrentRun()) {
                groundingSearchData = fallbackData;
                groundingSearchQuery = fallbackData.searchMeta?.queryUsed || fallbackQuery;
                groundingFreshnessRequested = fallbackFreshnessRequested;
                const fallbackVideos = filterRelevantMedia(fallbackData.media?.videos, fallbackQuery);
                const fallbackImages = filterRelevantMedia(fallbackData.media?.images, fallbackQuery);
                const fallbackArticleCandidates = [
                  ...(Array.isArray(fallbackData.media?.articles) ? fallbackData.media.articles : []),
                  ...fallbackResults.map((result) => ({
                    ...result,
                    type: result.type || 'article',
                    confidence: Number(result.confidence || 1),
                  })),
                ];
                const fallbackArticles = filterHighConfidenceArticles(fallbackArticleCandidates, fallbackQuery)
                  .filter((article, index, articles) => (
                    articles.findIndex((candidate) => candidate.url === article.url) === index
                  ));
                if (fallbackVideos.length || fallbackImages.length || fallbackArticles.length) {
                  mediaForMessage = {
                    videos: fallbackVideos,
                    images: fallbackImages,
                    articles: fallbackArticles,
                    query: fallbackQuery,
                  };
                }
                const snippets = fallbackResults
                  .map((r, i) => `[${i + 1}] ${r.title}${r.publishedAt ? `\nPublished: ${r.publishedAt}` : '\nPublished: date unavailable'}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                const fallbackFreshnessRules = fallbackFreshnessRequested
                  ? '\n- The user needs latest/current information. Use only the newest relevant retrieved facts, prefer the greatest Published timestamp, state its exact date, and ignore older conflicting claims. If dates are unavailable, say recency could not be confirmed.'
                  : '';
                const groundedUserContent = `${content}${recentConversationContextBlock}${sharedProjectContextBlock ? `\n\n${sharedProjectContextBlock}` : ''}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${fallbackData.freshness?.retrievedAt || new Date().toISOString()}) ===\nSearch query used: "${fallbackQuery}"\nFreshness requested: ${fallbackFreshnessRequested ? 'yes' : 'no'}\nNewest dated result: ${fallbackData.freshness?.newestPublishedAt || 'date unavailable'}\n\n${snippets}\n=== END SEARCH DATA ===\n\nUSAGE RULES:\n- These results are LIVE data fetched right now from the internet — your training cutoff does NOT apply here.${fallbackFreshnessRules}\n- Use all relevant project, conversation, document, image-analysis, and web evidence. Project context is first-party knowledge and remains valid when public results are sparse.\n- Keep the answer polished and concise. Do not print numeric source markers; source provenance is handled separately.\n- Do not repeat that you lack current information when project or web evidence answers the question.\n- Never invent URLs, citations, numbers, or facts beyond these sources. If the sources conflict, state the discrepancy.`;
                history[history.length - 1] = { role: 'user', content: groundedUserContent };

                let retryText = '';
                let retryFirstChunkSeen = false;
                try {
                  await sendChatMessage(
                    history,
                    (accumulated) => {
                      if (!isCurrentRun()) return;
                      if (!retryFirstChunkSeen && accumulated) { retryFirstChunkSeen = true; setIsSearching(false); }
                      retryText = accumulated;
                      flushStreamingContent(stripAllControlText(accumulated));
                    },
                    images,
                    {
                      desktopCoding: desktopWorkspaceRequest.active,
                      think: false,
                      tools: [],
                      onThinking: (accumulated) => {
                        if (!isCurrentRun()) return;
                        finalThinkingText = stripAllControlText(accumulated);
                        if (!retryFirstChunkSeen && accumulated) { retryFirstChunkSeen = true; setIsSearching(false); }
                        flushThinkingContent(finalThinkingText);
                      },
                    },
                  );
                } catch (retryErr) {
                  console.warn('Auto web-search retry failed:', retryErr?.message);
                  retryText = buildEvidenceFallbackAnswer(fallbackData, fallbackQuery);
                  diagnosticWarn('search', 'grounded regeneration failed; using evidence fallback', {
                    runId,
                    query: String(fallbackQuery).slice(0, 180),
                    error: retryErr?.message || 'Unknown regeneration error',
                  });
                }

                if (retryText && retryText.trim() && isCurrentRun()) {
                  fullText = stripAllControlText(retryText);
                }
              } else if (requestedWebSearchQuery) {
                fullText = await regenerateFromProjectContext(
                  `No useful public web results were found for "${fallbackQuery}".`,
                ) || `I searched the web for "${fallbackQuery}", but the available sources did not provide enough reliable information to answer confidently.`;
              }
            } catch (autoErr) {
              console.warn('Auto fallback web search failed:', autoErr?.message);
              if (requestedWebSearchQuery) {
                fullText = await regenerateFromProjectContext(
                  'Public web validation was temporarily unavailable.',
                ) || 'I tried to search the internet for this, but the search service is temporarily unavailable. Please try again in a moment.';
              }
            } finally {
              if (isCurrentRun()) setIsSearching(false);
            }
          }

          fullText = stripAllControlText(fullText);

          // ── Grounded answer quality gate ──
          // Search can succeed while a weaker model still emits a disclaimer,
          // talks about the search process, introduces itself, or ignores the
          // relevant evidence. Reject that draft and regenerate once with a
          // stronger model and a precise correction contract.
          const qualityEligible =
            !requestFailed
            && isCurrentRun()
            && !wantsImageGeneration
            && !wantsVideoGeneration
            && !requestedDocumentFormat
            && !deterministicMediaReply
            && Boolean(groundingSearchData)
            && String(fullText || '').trim().length > 0;
          const qualityAssessment = qualityEligible
            ? assessResponseQuality({
              answer: fullText,
              userQuery: content,
              searchData: groundingSearchData,
              searchQuery: groundingSearchQuery,
            })
            : { ok: true, reasons: [] };

          if (!qualityAssessment.ok && isCurrentRun()) {
            diagnosticWarn('model', 'quality rewrite activated', {
              runId,
              reasons: qualityAssessment.reasons,
              grounded: Boolean(groundingSearchData),
            });
            cancelPendingStreamFlushes();
            setStreamingContent('');
            setThinkingContent('');
            setIsSearching(Boolean(groundingSearchData));

            const correction = buildQualityCorrectionPrompt({
              userQuery: content,
              reasons: qualityAssessment.reasons,
              freshnessRequested: groundingFreshnessRequested,
            });
            const correctedHistory = history.slice();
            const lastIndex = correctedHistory.length - 1;
            if (lastIndex >= 0 && correctedHistory[lastIndex]?.role === 'user') {
              correctedHistory[lastIndex] = {
                ...correctedHistory[lastIndex],
                content: `${correctedHistory[lastIndex].content}\n\n${correction}`,
              };
            } else {
              correctedHistory.push({ role: 'user', content: correction });
            }

            let correctedText = '';
            try {
              await sendChatMessage(
                correctedHistory,
                (accumulated) => {
                  if (!isCurrentRun()) return;
                  correctedText = stripAllControlText(accumulated);
                  flushStreamingContent(correctedText);
                },
                images,
                {
                  desktopCoding: desktopWorkspaceRequest.active,
                  think: true,
                  tools: responseModelTools,
                  onThinking: (accumulated) => {
                    if (!isCurrentRun()) return;
                    finalThinkingText = stripAllControlText(accumulated);
                    flushThinkingContent(finalThinkingText);
                  },
                },
              );
            } catch (qualityErr) {
              console.warn('Quality correction retry failed:', qualityErr?.message);
            } finally {
              if (isCurrentRun()) setIsSearching(false);
            }

            if (correctedText.trim() && isCurrentRun()) {
              fullText = correctedText.trim();
            }

          }

          if (fullText) {
            // Strip + persist [REMEMBER: key=value] markers before display
            fullText = processRememberMarkers(fullText);
            fullText = sanitizeMemoryLeakStyleResponse(fullText);
            fullText = polishAssistantAnswer(fullText, {
              grounded: Boolean(groundingSearchData),
            });
            completedAnswer = fullText;
            if (options.voice) {
              options.onResponseChunk?.(fullText, { final: true });
            }

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
                isStreaming: false,
                ...(finalThinkingText ? { thinkingContent: finalThinkingText } : {}),
                ...(workspaceChangesForMessage.length ? { workspaceChanges: workspaceChangesForMessage } : {}),
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
              await activeResponseRef.current?.syncWriter?.finish();
              await updateMessage(convId, assistantMsgId, documentUpdate);
              setMessages((prev) => prev.map((msg) => (
                msg.id === assistantMsgId ? { ...msg, ...documentUpdate } : msg
              )));
            } else {
              const assistantUpdate = {
                content: fullText,
                isStreaming: false,
                ...(finalThinkingText ? { thinkingContent: finalThinkingText } : {}),
                ...(workspaceChangesForMessage.length ? { workspaceChanges: workspaceChangesForMessage } : {}),
                ...(mediaForMessage ? { media: mediaForMessage } : {}),
                ...(generatedMediaForMessage ? { generatedMedia: generatedMediaForMessage } : {}),
              };
              await activeResponseRef.current?.syncWriter?.finish();
              await updateMessage(convId, assistantMsgId, assistantUpdate);
              setMessages((prev) => prev.map((msg) => (
                msg.id === assistantMsgId ? { ...msg, ...assistantUpdate } : msg
              )));
            }

            if (isNewChat) {
              generateSmartTitle(content, titleSource).then((title) => {
                persistConversationUpdate(convId, { title });
              });
            }
            const titleTranscript = [
              ...historySource,
              { role: 'user', content },
              { role: 'assistant', content: titleSource },
            ];
            refreshConversationTitle(convId, titleTranscript).catch(() => {});
            await persistProjectTurn(titleSource);
            await persistWorkspaceTurn(titleSource);
          }
        }
      } catch (err) {
        console.error('Send message error:', err);
        if (generationRunRef.current === runId && !abortRef.current && assistantMsgId) {
          const failureText = `Sorry, I couldn't complete that response. ${err?.message || 'Please try again.'}`;
          setMessages((prev) => prev.map((msg) => (
            msg.id === assistantMsgId
              ? { ...msg, content: failureText, isStreaming: false }
              : msg
          )));
          await activeResponseRef.current?.syncWriter?.finish();
          updateMessage(convId, assistantMsgId, {
            content: failureText,
            isStreaming: false,
          }).catch((persistErr) => {
            console.warn('Failed to persist terminal chat error:', persistErr?.message);
          });
        }
      } finally {
        if (lockedConversationId) {
          releaseConversationRun(lockedConversationId, projectRunToken).catch((error) => {
            console.warn('Failed to release project chat run:', error?.message);
          });
        }
        if (generationRunRef.current !== runId) return;
        if (activeResponseRef.current?.runId === runId) {
          await activeResponseRef.current.syncWriter?.finish();
          await updateMessage(
            activeResponseRef.current.conversationId,
            activeResponseRef.current.messageId,
            { isStreaming: false, streamCompletedAt: Date.now() },
          ).catch(() => {});
          activeResponseRef.current = null;
        }
        cancelPendingStreamFlushes();
        setIsGenerating(false);
        setIsSearching(false);
        setStreamingContent('');
        setThinkingContent('');
      }
      return { answer: completedAnswer };
    },
    [
      currentConversationId,
      isGenerating,
      messages,
      user,
      setCurrentConversationId,
      setIsGenerating,
      setIsSearching,
      activeProjectId,
      normalizeImageForUpload,
      pruneMessagesAfter,
      refreshConversationTitle,
      persistConversationUpdate,
      finalizeActiveResponse,
      profile,
    ]
  );

  const retryMessage = useCallback(async (message, webSearch = false) => {
    if (!message?.id || message.role !== 'user') return;
    await sendMessage(message.content || '', cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
      interruptExisting: true,
      ...(message.promptContent ? { promptContent: message.promptContent } : {}),
      ...(message.webPage ? { webPage: message.webPage } : {}),
    });
  }, [sendMessage]);

  const editMessage = useCallback(async (message, nextContent, webSearch = false) => {
    if (!message?.id || message.role !== 'user') return;
    const content = String(nextContent || '').trim();
    if (!content) return;

    await sendMessage(content, cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
      interruptExisting: true,
    });
  }, [sendMessage]);

  return {
    messages,
    streamingContent,
    thinkingContent,
    taskWorkflow,
    clearTaskWorkflow: () => setTaskWorkflow(null),
    sendMessage,
    stopGenerating,
    isGenerating,
    retryMessage,
    editMessage,
  };
}

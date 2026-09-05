import { MODEL_TOOLS } from './modelTools.js';
import { TOOL_NAMES } from './toolControl.js';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatRetryDelayMs,
  getChatTimeoutMessage,
  getResponseHeadersTimeout,
  shouldRetryChatRequest,
  shouldRetryChatRequestAfterHealth,
} from './chatRequestPolicy.js';
import { diagnosticError, diagnosticLog, diagnosticWarn } from './diagnostics.js';
import { notifyDesktopProviderRequired, requestDesktopAgentChat } from './desktopBridge.js';
import { composeMiraSystemPrompt } from '../config/systemPrompt.js';
import { completeChatResponse } from './responseContinuation.js';

let activeChatAbortController = null;
let activeChatRequestId = null;
let lifecycleCancellationInstalled = false;

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function isAbortError(err) {
  return err?.name === 'AbortError' || /abort|stopp?ed/i.test(String(err?.message || ''));
}

class ChatTimeoutError extends Error {
  constructor(kind) {
    super(getChatTimeoutMessage(kind));
    this.name = 'ChatTimeoutError';
    this.kind = kind;
  }
}

class ChatHttpError extends Error {
  constructor(status, message) {
    super(message || `API error: ${status}`);
    this.name = 'ChatHttpError';
    this.status = Number(status) || 500;
  }
}

function createAttemptSignal(parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  return {
    controller,
    cleanup: () => parentSignal?.removeEventListener?.('abort', abortFromParent),
  };
}

function raceWithTimeout(promise, timeoutMs, kind, onTimeout) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try { onTimeout?.(); } catch { /* ignore timeout cleanup errors */ }
      reject(new ChatTimeoutError(kind));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancelChatAttempt(requestId) {
  if (!requestId) return;
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', requestId }),
      keepalive: true,
    });
  } catch {
    // The attempt's local abort has already closed the client connection.
  }
}

async function diagnoseChatFailure(originalError, attemptNumber) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const health = await response.json().catch(() => ({}));
    diagnosticWarn('health', 'automatic troubleshooting completed', {
      attempt: attemptNumber,
      originalError: originalError?.message || 'Unknown chat failure',
      ready: Boolean(health?.ready),
      registryReachable: Boolean(health?.registryReachable),
      loadedModelCount: Number(health?.loadedModelCount || 0),
      latencyMs: Number(health?.latencyMs || 0),
    });
    return health;
  } catch (error) {
    diagnosticWarn('health', 'automatic troubleshooting could not reach health endpoint', {
      attempt: attemptNumber,
      error: error?.name === 'AbortError' ? 'Health check timed out.' : (error?.message || 'Health check failed.'),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
    .join('');
}

function extractToolCalls(payload) {
  const candidates = [
    payload?.tool_calls,
    payload?.message?.tool_calls,
    payload?.delta?.tool_calls,
    payload?.choices?.[0]?.delta?.tool_calls,
    payload?.choices?.[0]?.message?.tool_calls,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

function parseToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Some local tool-capable models wrap string values in repeated quotes
    // (for example {"query":"""algae tree"""}). Repair only that narrow
    // shape so malformed tool arguments remain hidden and executable.
    const repaired = value.replace(
      /:\s*"{2,}\s*([^"\r\n]*?)\s*"{2,}\s*(?=[,}])/g,
      (_, content) => `:${JSON.stringify(content.trim())}`,
    );
    try {
      const parsed = JSON.parse(repaired);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

export function toolCallsToControl(toolCalls = []) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  for (const toolCall of toolCalls) {
    const name = String(toolCall?.function?.name || toolCall?.name || '').trim().toLowerCase();
    if (!Object.values(TOOL_NAMES).includes(name)) continue;
    const args = parseToolArguments(toolCall?.function?.arguments ?? toolCall?.arguments);
    return `[MIRA_TOOL: ${JSON.stringify({ name, arguments: args })}]`;
  }
  return '';
}

export function extractChatText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  // A native tool call takes precedence over any companion content. Several
  // providers echo raw function arguments into `content`; rendering that text
  // leaks internal controls and prevents the host from executing the call.
  const nativeToolCalls = extractToolCalls(payload);
  if (nativeToolCalls.length) return toolCallsToControl(nativeToolCalls);

  const candidates = [
    payload.text,
    payload.result,
    payload.response,
    payload.content,
    payload.message?.content,
    payload.delta?.content,
    payload.choices?.[0]?.delta?.content,
    payload.choices?.[0]?.message?.content,
    payload.choices?.[0]?.text,
  ];

  for (const candidate of candidates) {
    const text = contentToText(candidate);
    if (text) return text;
  }
  return '';
}

export function extractThinkingText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const candidates = [
    payload.thinking,
    payload.reasoning,
    payload.reasoning_content,
    payload.message?.thinking,
    payload.message?.reasoning,
    payload.message?.reasoning_content,
    payload.delta?.thinking,
    payload.delta?.reasoning,
    payload.delta?.reasoning_content,
    payload.choices?.[0]?.delta?.thinking,
    payload.choices?.[0]?.delta?.reasoning,
    payload.choices?.[0]?.delta?.reasoning_content,
    payload.choices?.[0]?.message?.thinking,
    payload.choices?.[0]?.message?.reasoning,
    payload.choices?.[0]?.message?.reasoning_content,
  ];

  for (const candidate of candidates) {
    const text = contentToText(candidate);
    if (text) return text;
  }
  return '';
}

function parseStreamData(data) {
  if (!data || data === '[DONE]') return { answer: '', thinking: '', completed: data === '[DONE]' };
  try {
    const payload = JSON.parse(data);
    return {
      answer: extractChatText(payload),
      thinking: extractThinkingText(payload),
      completed: payload.done === true || Boolean(payload.choices?.[0]?.finish_reason),
      finishReason: payload.choices?.[0]?.finish_reason || payload.done_reason || '',
    };
  } catch {
    return {
      answer: data.startsWith('{') || data.startsWith('[') ? '' : data,
      thinking: '',
    };
  }
}

function extractCompleteJsonChunks(buffer) {
  const chunks = [];
  const text = String(buffer || '');
  const len = text.length;
  let index = 0;

  while (index < len) {
    // Skip anything that isn't the start of a JSON object/array. Some providers
    // (OpenAI-style / SSE-style) wrap each chunk in framing like
    // "data: {...}\n\n"; we just want the JSON payload regardless of prefix.
    while (index < len && text[index] !== '{' && text[index] !== '[') index += 1;
    if (index >= len) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = index; i < len; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break;
    chunks.push(text.slice(index, end + 1));
    index = end + 1;
  }

  return { chunks, remainder: text.slice(index) };
}

export async function readChatResponse(response, onChunk, signal) {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const parsed = parseStreamData(text.trim());
    const answer = parsed.answer || text;
    if (parsed.thinking || answer) {
      onChunk?.({
        answerDelta: answer,
        answerFull: answer,
        thinkingDelta: parsed.thinking || '',
        thinkingFull: parsed.thinking || '',
      });
    }
    return { answer, thinking: parsed.thinking || '' };
  }

  const onAbort = () => {
    try { reader.cancel(); } catch { /* ignore */ }
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });

  const decoder = new TextDecoder();
  let buffer = '';
  let fullAnswer = '';
  let fullThinking = '';
  let completed = false;
  let finishReason = '';

  const append = ({ answer, thinking, completed: ended, finishReason: reason }) => {
    completed ||= Boolean(ended);
    if (reason) finishReason = reason;
    const answerDelta = answer || '';
    const thinkingDelta = thinking || '';
    if (!answerDelta && !thinkingDelta) return;

    if (thinkingDelta) fullThinking += thinkingDelta;
    if (answerDelta) fullAnswer += answerDelta;

    onChunk?.({
      answerDelta,
      answerFull: fullAnswer,
      thinkingDelta,
      thinkingFull: fullThinking,
    });
  };

  const flushBuffer = ({ includeRemainder = false } = {}) => {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('event:') || trimmed.startsWith('id:')) continue;
      const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      append(parseStreamData(data));
    }

    const parsed = extractCompleteJsonChunks(buffer);
    for (const chunk of parsed.chunks) {
      append(parseStreamData(chunk));
    }
    buffer = parsed.remainder;

    if (includeRemainder) {
      const remainder = buffer.trim();
      if (remainder) {
        const data = remainder.startsWith('data:') ? remainder.slice(5).trim() : remainder;
        append(parseStreamData(data));
      }
      buffer = '';
    }
  };

  try {
    const startedAt = Date.now();
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Generation stopped by user.', 'AbortError');
      }
      const remainingAttemptMs = Math.max(
        1,
        CHAT_REQUEST_TIMEOUTS.totalAttemptMs - (Date.now() - startedAt),
      );
      const readTimeoutMs = Math.min(CHAT_REQUEST_TIMEOUTS.streamIdleMs, remainingAttemptMs);
      const timeoutKind = remainingAttemptMs <= CHAT_REQUEST_TIMEOUTS.streamIdleMs
        ? 'total-attempt'
        : 'stream-idle';
      const { done, value } = await raceWithTimeout(
        reader.read(),
        readTimeoutMs,
        timeoutKind,
        () => reader.cancel().catch?.(() => {}),
      );
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      flushBuffer();
    }

    flushBuffer({ includeRemainder: true });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || !fullAnswer) throw error;
    completed = false;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }

  if (signal?.aborted) throw new DOMException('Generation stopped by user.', 'AbortError');
  return { answer: fullAnswer, thinking: fullThinking, incomplete: !completed || finishReason === 'length', finishReason };
}

async function extractApiError(response) {
  try {
    const payload = await response.json();
    const candidate = payload?.error?.message || payload?.error || payload?.detail || payload?.message || '';
    const text = typeof candidate === 'string' ? candidate : JSON.stringify(candidate || '');
    return String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  } catch {
    const text = await response.text().catch(() => '');
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }
}

export function stopChatGeneration() {
  const controller = activeChatAbortController;
  const requestId = activeChatRequestId;
  activeChatAbortController = null;
  activeChatRequestId = null;

  // 1) Abort the in-flight client fetch synchronously. Closing this TCP
  //    connection makes our server fire its `req.signal`/`req.close`
  //    listener, which in turn aborts the upstream provider fetch.
  if (controller && !controller.signal.aborted) {
    diagnosticWarn('stream', 'user cancellation requested', { requestId });
    try { controller.abort(); } catch { /* ignore */ }
  }

  // 2) Belt-and-braces: also POST a cancel request keyed by requestId.
  //    This covers cases where the server-side close listener is missed
  //    (e.g. proxy buffering, serverless edge). The server uses the id
  //    to look up the in-flight controller and abort it.
  if (!requestId) return;

  const payload = JSON.stringify({ action: 'cancel', requestId });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/chat', blob)) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — local abort has already stopped client streaming.
  }
}

export function installGenerationExitCancellation() {
  if (lifecycleCancellationInstalled || typeof window === 'undefined') return () => {};
  lifecycleCancellationInstalled = true;

  const cancelForExit = () => stopChatGeneration();

  window.addEventListener('pagehide', cancelForExit, { capture: true });
  window.addEventListener('beforeunload', cancelForExit, { capture: true });

  return () => {
    window.removeEventListener('pagehide', cancelForExit, { capture: true });
    window.removeEventListener('beforeunload', cancelForExit, { capture: true });
    lifecycleCancellationInstalled = false;
  };
}

async function requestChat(options) {
  return completeChatResponse(options, requestChatSegment);
}

async function requestChatSegment({
  messages,
  images = [],
  systemPrompt,
  maxTokens,
  tools = MODEL_TOOLS,
  think,
  onChunk,
  endpoint = '/api/chat',
  desktopCoding = false,
  requestClass = 'chat',
}) {
  const controller = new AbortController();
  activeChatAbortController = controller;

  try {
    // Task steps already have workflow-level retries. Retrying here as well
    // multiplied one transient outage into six near-simultaneous requests.
    const maxAttempts = requestClass === 'task' ? 1 : 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const requestId = createRequestId();
      activeChatRequestId = requestId;
      const { controller: attemptController, cleanup: cleanupAttemptSignal } = createAttemptSignal(controller.signal);
      const attemptStartedAt = Date.now();
      let receivedAnswer = false;

      try {
        diagnosticLog('model', 'request started', {
          requestId,
          attempt,
          maxAttempts,
          streaming: true,
          imageCount: images.length,
        });
        const response = await raceWithTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(desktopCoding ? { 'X-Mira-Desktop': '1' } : {}),
            },
            signal: attemptController.signal,
            body: JSON.stringify({
              requestId,
              messages,
              ...(systemPrompt ? { systemPrompt } : {}),
              images,
              stream: true,
              ...(maxTokens ? { max_tokens: maxTokens } : {}),
              ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
              ...(typeof think === 'boolean' ? { think } : {}),
              ...(desktopCoding ? { desktopCoding: true } : {}),
              ...(requestClass === 'task' ? { requestClass: 'task' } : {}),
            }),
          }),
          getResponseHeadersTimeout(),
          'response-headers',
          () => attemptController.abort(),
        );
        diagnosticLog('stream', 'response headers received', {
          requestId,
          attempt,
          status: response.status,
          elapsedMs: Date.now() - attemptStartedAt,
        });
        if (!response.ok) {
          const message = await extractApiError(response);
          throw new ChatHttpError(response.status, message);
        }
        const streamed = await readChatResponse(response, (chunk) => {
          if (String(chunk?.answerFull || '').trim()) receivedAnswer = true;
          onChunk?.(chunk);
        }, attemptController.signal);
        const visible = splitThinkingFromRaw(streamed?.answer || '').answer;
        if (!String(visible || '').trim()) throw new Error('The model returned an empty response.');
        diagnosticLog('stream', 'response completed', {
          requestId,
          attempt,
          answerChars: String(visible || '').length,
          thinkingChars: String(streamed?.thinking || '').length,
          elapsedMs: Date.now() - attemptStartedAt,
        });
        return streamed;
      } catch (err) {
        if (controller.signal.aborted) throw new DOMException('Generation stopped by user.', 'AbortError');
        const normalizedError = isAbortError(err) && attemptController.signal.aborted
          ? new ChatTimeoutError('response-headers')
          : err;
        const retryCandidate = !receivedAnswer && shouldRetryChatRequest(normalizedError, attempt, maxAttempts);
        diagnosticError('stream', retryCandidate ? 'request failed; checking automatic recovery' : 'request failed', {
          requestId,
          attempt,
          retry: retryCandidate,
          error: normalizedError?.message || 'Unknown request error',
          errorType: normalizedError?.name || 'Error',
          elapsedMs: Date.now() - attemptStartedAt,
        });
        if (!retryCandidate) throw normalizedError;

        attemptController.abort();
        await cancelChatAttempt(requestId);
        const [health] = await Promise.all([
          diagnoseChatFailure(normalizedError, attempt),
          wait(getChatRetryDelayMs(attempt)),
        ]);
        if (!shouldRetryChatRequestAfterHealth(normalizedError, health)) {
          diagnosticWarn('stream', 'automatic retry skipped while the model server is cold', {
            requestId,
            attempt,
            loadedModelCount: Number(health?.loadedModelCount || 0),
          });
          throw normalizedError;
        }
      } finally {
        cleanupAttemptSignal();
      }
    }
    throw new Error('Chat request failed after automatic recovery.');
  } finally {
    if (activeChatAbortController === controller) {
      activeChatAbortController = null;
      activeChatRequestId = null;
    }
  }
}

function splitThinkingFromRaw(raw = '') {
  const normalized = String(raw || '')
    .replace(/<thinking>/gi, '<think>')
    .replace(/<\/thinking>/gi, '</think>');

  let answer = normalized;
  const thinkingParts = [];

  const completeBlockPattern = /<think>([\s\S]*?)<\/think>/gi;
  answer = answer.replace(completeBlockPattern, (_full, inner) => {
    if (inner) thinkingParts.push(inner);
    return '';
  });

  const openIndex = answer.toLowerCase().lastIndexOf('<think>');
  if (openIndex !== -1) {
    const partial = answer.slice(openIndex + '<think>'.length);
    if (partial) thinkingParts.push(partial);
    answer = answer.slice(0, openIndex);
  }

  answer = answer.replace(/<\/?think>/gi, '');

  return {
    thinking: thinkingParts.join(' ').replace(/\s+/g, ' ').trim(),
    answer,
  };
}

export async function runChatCompletion({ messages, images = [], systemPrompt, maxTokens, tools = [], think } = {}) {
  const result = await requestChat({ messages, images, systemPrompt, maxTokens, tools, think });
  const answer = result?.answer || '';
  if (!answer) throw new Error('No result in response');
  return { result: answer };
}

async function requestPollinationsFallback({ messages, systemPrompt, tools, maxTokens }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  activeChatAbortController = controller;
  activeChatRequestId = `fallback:${createRequestId()}`;
  try {
    const response = await fetch('/api/code-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'chat',
        scope: 'desktop-coding',
        messages,
        systemPrompt,
        tools,
        maxTokens,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ChatHttpError(response.status, payload?.error || 'Fallback completion failed.');
    const control = toolCallsToControl(payload?.toolCalls);
    const answer = control || String(payload?.suggestion || '').trim();
    if (!answer) throw new Error('The fallback completion returned no result.');
    diagnosticWarn('model', 'primary model unavailable; Pollinations completion fallback succeeded', {
      toolCall: Boolean(control),
      answerChars: answer.length,
    });
    return { answer, thinking: '' };
  } finally {
    clearTimeout(timeout);
    if (activeChatAbortController === controller) activeChatAbortController = null;
    if (String(activeChatRequestId || '').startsWith('fallback:')) activeChatRequestId = null;
  }
}

export async function sendChatMessage(messages, onChunk, images = [], {
  onThinking,
  systemPrompt,
  tools = MODEL_TOOLS,
  think,
  maxTokens,
  voice = false,
  desktopCoding = false,
  requestClass = 'chat',
} = {}) {
  let latestAnswer = '';
  let latestThinking = '';
  let streamed;
  let desktopProviderError = null;
  if (desktopCoding && !images.length && !voice) {
    try {
      const desktop = await requestDesktopAgentChat({
        messages,
        systemPrompt: composeMiraSystemPrompt(systemPrompt),
        tools,
        think,
        maxTokens,
      });
      if (desktop) {
        const control = toolCallsToControl(desktop.toolCalls);
        const answer = control || String(desktop.answer || '').trim();
        if (!answer) throw new Error('The desktop coding provider returned no result.');
        const thinking = String(desktop.thinking || '').trim();
        if (thinking) onThinking?.(thinking);
        onChunk?.(answer, answer);
        return answer;
      }
    } catch (error) {
      desktopProviderError = error;
      notifyDesktopProviderRequired(error);
      diagnosticWarn('model', 'desktop coding provider unavailable; using primary model fallback', {
        error: error?.message || 'Unknown desktop provider error',
      });
    }
  }
  try {
    streamed = await requestChat({
      messages,
      images,
      systemPrompt: composeMiraSystemPrompt(systemPrompt),
      tools: voice ? [] : tools,
      think: voice ? false : think,
      maxTokens,
      endpoint: voice ? '/api/voice-chat' : '/api/chat',
      desktopCoding,
      requestClass,
      onChunk: ({ answerFull, thinkingFull }) => {
        const split = splitThinkingFromRaw(answerFull || '');
        const mergedThinking = [thinkingFull || '', split.thinking || '']
          .filter(Boolean)
          .join('\n')
          .trim();

        latestThinking = mergedThinking;
        latestAnswer = split.answer || '';

        if (mergedThinking) onThinking?.(mergedThinking);
        onChunk?.(latestAnswer, latestAnswer);
      },
    });
  } catch (error) {
    if (isAbortError(error) || images.length || voice || !desktopCoding) throw error;
    diagnosticWarn('model', 'desktop coding providers failed; trying Pollinations coding fallback', {
      error: error?.message || 'Unknown model failure',
    });
    try {
      streamed = await requestPollinationsFallback({
        messages,
        systemPrompt: composeMiraSystemPrompt(systemPrompt),
        tools,
        maxTokens,
      });
    } catch (fallbackError) {
      if (desktopProviderError?.code === 'provider_reconnect_required') {
        throw desktopProviderError;
      }
      throw fallbackError;
    }
    latestAnswer = streamed.answer;
    onChunk?.(latestAnswer, latestAnswer);
  }

  const split = splitThinkingFromRaw(streamed?.answer || '');
  const finalThinking = [streamed?.thinking || '', split.thinking || '']
    .filter(Boolean)
    .join('\n')
    .trim();
  const rawWithoutThinkTags = String(streamed?.answer || '')
    .replace(/<thinking>/gi, '')
    .replace(/<\/thinking>/gi, '')
    .replace(/<think>/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
  const finalAnswer = split.answer || latestAnswer || rawWithoutThinkTags;
  if (finalThinking) onThinking?.(finalThinking);
  if (finalAnswer) return finalAnswer;

  // Never promote private reasoning into the visible answer.
  throw new Error('No result in response');
}

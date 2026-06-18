import { MODEL_TOOLS } from './modelTools';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatTimeoutMessage,
  getResponseHeadersTimeout,
  getRetryModel,
} from './chatRequestPolicy.js';
import { diagnosticError, diagnosticLog, diagnosticWarn } from './diagnostics.js';

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

function toolCallsToText(toolCalls = []) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  const names = toolCalls
    .map((toolCall) => toolCall?.function?.name || toolCall?.name || toolCall?.type)
    .filter(Boolean);
  if (names.length === 0) return '';
  return `[Using tools: ${names.join(', ')}]`;
}

export function extractChatText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const geminiAnswer = Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
      .filter((part) => part?.thought !== true)
      .map((part) => contentToText(part?.text))
      .join('')
    : '';
  const candidates = [
    geminiAnswer,
    payload.text,
    payload.result,
    payload.response,
    payload.content,
    payload.message?.content,
    payload.delta?.content,
    payload.choices?.[0]?.delta?.content,
    payload.choices?.[0]?.message?.content,
    payload.choices?.[0]?.text,
    toolCallsToText(extractToolCalls(payload)),
  ];

  for (const candidate of candidates) {
    const text = contentToText(candidate);
    if (text) return text;
  }
  return '';
}

export function extractThinkingText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const geminiThinking = Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
      .filter((part) => part?.thought === true)
      .map((part) => contentToText(part?.text))
      .join('')
    : '';
  const candidates = [
    geminiThinking,
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
  if (!data || data === '[DONE]') return { answer: '', thinking: '' };
  try {
    const payload = JSON.parse(data);
    return {
      answer: extractChatText(payload),
      thinking: extractThinkingText(payload),
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

async function readChatResponse(response, onChunk, signal) {
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

  const append = ({ answer, thinking }) => {
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
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }

  return { answer: fullAnswer, thinking: fullThinking };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  //    listener, which in turn aborts the upstream Ollama fetch.
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

async function requestChat({ messages, model, images = [], systemPrompt, maxTokens, tools = MODEL_TOOLS, think, onChunk }) {
  const transientStatus = new Set([408, 429, 500, 502, 503, 504]);
  const maxAttempts = 3;
  const controller = new AbortController();
  activeChatAbortController = controller;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (controller.signal.aborted) {
        throw new DOMException('Generation stopped by user.', 'AbortError');
      }

      const requestId = createRequestId();
      const attemptModel = getRetryModel(model, attempt);
      activeChatRequestId = requestId;
      const { controller: attemptController, cleanup: cleanupAttemptSignal } = createAttemptSignal(controller.signal);
      const attemptStartedAt = Date.now();
      diagnosticLog('model', attempt === 1 ? 'request started' : 'client fallback activated', {
        requestId,
        attempt,
        requestedModel: model || 'auto',
        attemptModel: attemptModel || 'auto',
        streaming: true,
        imageCount: images.length,
      });
      try {
        const response = await raceWithTimeout(
          fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: attemptController.signal,
            body: JSON.stringify({
              requestId,
              messages,
              ...(attemptModel ? { model: attemptModel } : {}),
              ...(systemPrompt ? { systemPrompt } : {}),
              images,
              stream: true,
              ...(maxTokens ? { max_tokens: maxTokens } : {}),
              ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
              ...(typeof think === 'boolean' ? { think } : {}),
            }),
          }),
          getResponseHeadersTimeout(attemptModel),
          'response-headers',
          () => attemptController.abort(),
        );

        const modelUsed = String(response.headers.get('x-mira-model-used') || '').trim();
        diagnosticLog('stream', 'response headers received', {
          requestId,
          attempt,
          status: response.status,
          requestedModel: attemptModel || 'auto',
          modelUsed: modelUsed || 'not-reported',
          elapsedMs: Date.now() - attemptStartedAt,
        });

        if (response.ok) {
          const streamed = await readChatResponse(response, onChunk, attemptController.signal);
          const visible = splitThinkingFromRaw(streamed?.answer || '').answer;
          const hasAnswer = Boolean(String(visible || '').trim());
          if (!hasAnswer && attempt < maxAttempts) {
            diagnosticWarn('model', 'empty response; activating fallback', {
              requestId,
              attempt,
              model: attemptModel || 'auto',
              nextModel: getRetryModel(model, attempt + 1) || 'auto',
            });
            continue;
          }
          if (!hasAnswer) {
            throw new Error('The model returned an empty response.');
          }
          diagnosticLog('stream', 'response completed', {
            requestId,
            attempt,
            modelUsed: modelUsed || attemptModel || 'auto',
            answerChars: String(visible || '').length,
            thinkingChars: String(streamed?.thinking || '').length,
            elapsedMs: Date.now() - attemptStartedAt,
          });
          return {
            ...streamed,
            ...(modelUsed ? { modelUsed } : {}),
          };
        }

        const message = await extractApiError(response);
        const shouldRetry = transientStatus.has(response.status) && attempt < maxAttempts;
        if (shouldRetry) {
          diagnosticWarn('model', 'transient API error; activating fallback', {
            requestId,
            attempt,
            model: attemptModel || 'auto',
            status: response.status,
            nextModel: getRetryModel(model, attempt + 1) || 'auto',
            message,
          });
          await sleep(75 * attempt);
          continue;
        }

        throw new Error(message || `API error: ${response.status}`);
      } catch (err) {
        if (controller.signal.aborted) {
          throw new DOMException('Generation stopped by user.', 'AbortError');
        }

        // The timeout callback aborts only this attempt. Depending on microtask
        // ordering, fetch() can surface its AbortError before the watchdog's
        // ChatTimeoutError. Never mistake that per-attempt abort for the user
        // pressing Stop, or the UI will silently leave an empty assistant row.
        const normalizedError = isAbortError(err) && attemptController.signal.aborted
          ? new ChatTimeoutError('response-headers')
          : err;
        const likelyNetworkError = normalizedError?.name === 'ChatTimeoutError'
          || (!isAbortError(normalizedError) && !String(normalizedError?.message || '').startsWith('API error:'));
        const shouldRetry = likelyNetworkError && attempt < maxAttempts;
        if (shouldRetry) {
          diagnosticWarn('stream', 'request failed; activating fallback', {
            requestId,
            attempt,
            model: attemptModel || 'auto',
            nextModel: getRetryModel(model, attempt + 1) || 'auto',
            error: normalizedError?.message || 'Unknown request error',
            errorType: normalizedError?.name || 'Error',
            elapsedMs: Date.now() - attemptStartedAt,
          });
          await sleep(75 * attempt);
          continue;
        }
        diagnosticError('stream', 'request exhausted recovery', {
          requestId,
          attempt,
          model: attemptModel || 'auto',
          error: normalizedError?.message || 'Unknown request error',
          errorType: normalizedError?.name || 'Error',
          elapsedMs: Date.now() - attemptStartedAt,
        });
        throw normalizedError;
      } finally {
        cleanupAttemptSignal();
      }
    }

    throw new Error('Chat request failed after retries.');
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

export async function runChatCompletion({ messages, model, images = [], systemPrompt, maxTokens, tools = MODEL_TOOLS, think } = {}) {
  const result = await requestChat({ messages, model, images, systemPrompt, maxTokens, tools, think });
  const answer = result?.answer || '';
  if (!answer) throw new Error('No result in response');
  return { result: answer };
}

export async function sendChatMessage(messages, model, onChunk, images = [], { onThinking, onModelUsed, systemPrompt, tools = MODEL_TOOLS, think } = {}) {
  let latestAnswer = '';
  let latestThinking = '';
  const streamed = await requestChat({
    messages,
    model,
    images,
    systemPrompt,
    tools,
    think,
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
  const finalModelUsed = String(streamed?.modelUsed || '').trim();

  if (finalModelUsed) {
    onModelUsed?.(finalModelUsed);
  }

  if (finalThinking) onThinking?.(finalThinking);
  if (finalAnswer) return finalAnswer;

  // Never promote private reasoning into the visible answer.
  throw new Error('No result in response');
}

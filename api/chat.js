import { requestDeepSeekChat, requestManagedChat, prepareDeepSeekTools } from './code-assist.js';
import { guardRequest } from './_requestSecurity.js';
import {
  composeMiraSystemPrompt,
  MIRA_IDENTITY_PRIMER,
} from '../src/config/systemPrompt.js';

export const config = { maxDuration: 300 };

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const CHAT_TEMPERATURE = 0.2;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);
const ALLOWED_TOOL_NAMES = new Set([
  'user.ask',
  'web.search',
  'browser.inspect',
  'calculator.evaluate',
  'weather.lookup',
  'currency.convert',
  'code.run',
  'task.run',
  'image.generate',
  'video.generate',
  'desktop.screen_context',
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.replace',
  'filesystem.search',
  'workspace.index',
  'workspace.search',
  'workspace.validate',
  'workspace.start',
  'shell.run',
  'test.run',
  'git.status',
  'git.diff',
  'git.info',
  'git.pull',
  'git.push',
  'git.commit',
  'git.remote.set',
  'change.list',
  'change.undo',
  'change.redo',
]);
const ACTIVE_CHAT_REQUESTS = new Map();
const DEEPSEEK_FAILURE_COOLDOWN_MS = 30 * 1000;
let deepSeekUnavailableUntil = 0;
let webDeepSeekUnavailableUntil = 0;

const MIRA_BASE_URL = String(process.env.MIRA_BASE_URL || '').trim().replace(/\/+$/, '');
const MIRA_OPENAI_BASE_URL = String(
  process.env.MIRA_OPENAI_BASE_URL || (MIRA_BASE_URL ? `${MIRA_BASE_URL}/v1` : ''),
).trim().replace(/\/+$/, '');
const MIRA_CHAT_API_URL = MIRA_OPENAI_BASE_URL
  ? `${MIRA_OPENAI_BASE_URL}/chat/completions`
  : '';
const MIRA_CHAT_API_KEY = String(process.env.MIRA_API_TOKEN || '').trim();
const MIRA_CHAT_MODEL = String(process.env.MIRA_CHAT_MODEL || 'MIRA:latest').trim();
const MIRA_FAILURE_COOLDOWN_MS = 30 * 1000;
const MIRA_PRIMARY_ATTEMPTS = 2;
const MIRA_RETRY_DELAY_MS = 250;
const MIRA_PRIMARY_TIMEOUT_MS = 40 * 1000;
const MIRA_FIRST_CHUNK_TIMEOUT_MS = 20 * 1000;
const MIRA_STREAM_IDLE_MS = 45_000;
const MIRA_STREAM_TOTAL_MS = 240_000;
let miraUnavailableUntil = 0;

export function isMiraFallbackEligible(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '');
  if ([408, 425, 429].includes(status) || status >= 500) return true;
  if ([
    'mira_connect_timeout',
    'mira_empty_response',
    'mira_invalid_response',
    'upstream_stream_timeout',
  ].includes(code)) return true;
  return error instanceof TypeError;
}

function waitForMiraRetry(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, MIRA_RETRY_DELAY_MS);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function requestMiraPrimary(body, signal) {
  let lastError;
  for (let attempt = 1; attempt <= MIRA_PRIMARY_ATTEMPTS; attempt += 1) {
    try {
      const response = await miraChatResponse(body, signal);
      response.headers.set('X-Mira-Primary-Attempts', String(attempt));
      return response;
    } catch (error) {
      lastError = error;
      error.primaryAttempts = attempt;
      if (!isMiraFallbackEligible(error) || attempt >= MIRA_PRIMARY_ATTEMPTS) throw error;
      await waitForMiraRetry(signal);
    }
  }
  throw lastError;
}

function miraConfigurationError(error = null) {
  const authenticationFailed = [401, 403].includes(Number(error?.status || 0));
  return jsonResponse({
    error: authenticationFailed
      ? 'The MIRA API credential is missing or invalid.'
      : 'The MIRA API is not fully configured.',
    code: authenticationFailed ? 'mira_primary_authentication_failed' : 'mira_primary_not_configured',
    retryable: false,
  }, 503);
}

function prefersDeepSeekDesktopCoding() {
  return String(
    process.env.MIRA_DESKTOP_CODING_PROVIDER
    || process.env.MIRA_CHAT_PROVIDER
    || 'deepseek',
  ).trim().toLowerCase() !== 'pollinations';
}

function readUpstreamChunk(reader, timeoutMs) {
  let timer;
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('The model response stalled before it completed.');
        error.code = 'upstream_stream_timeout';
        reject(error);
      }, Math.max(1, timeoutMs));
    }),
  ]).finally(() => clearTimeout(timer));
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeMessages(messages = [], systemPrompt = '', requestClass = 'chat') {
  const normalized = (Array.isArray(messages) ? messages : [])
    .slice(-40)
    .map((message) => ({
      role: ALLOWED_ROLES.has(message?.role) ? message.role : 'user',
      content: typeof message?.content === 'string' ? message.content : String(message?.content || ''),
    }))
    .filter((message) => message.content.trim());

  const withoutSystem = normalized.filter((message) => message.role !== 'system');
  if (requestClass === 'task') {
    return [
      {
        role: 'system',
        content: String(systemPrompt || 'Complete the requested internal task phase accurately and concisely.').trim(),
      },
      ...withoutSystem,
    ];
  }
  return [
    { role: 'system', content: composeMiraSystemPrompt(systemPrompt) },
    ...MIRA_IDENTITY_PRIMER,
    ...withoutSystem,
  ];
}

export function sanitizeTools(tools = []) {
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, ALLOWED_TOOL_NAMES.size).flatMap((tool) => {
    const definition = tool?.function;
    const name = String(definition?.name || '').trim().toLowerCase();
    if (tool?.type !== 'function' || !ALLOWED_TOOL_NAMES.has(name)) return [];
    const parameters = definition?.parameters && typeof definition.parameters === 'object'
      ? definition.parameters
      : { type: 'object', properties: {} };
    return [{
      type: 'function',
      function: {
        name,
        description: String(definition?.description || '').slice(0, 300),
        parameters,
      },
    }];
  });
}

export async function managedFallbackResponse(body, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const result = await requestManagedChat({
      messages: body?.messages,
      systemPrompt: composeMiraSystemPrompt(body?.systemPrompt),
      tools: sanitizeTools(body?.tools),
      maxTokens: body?.max_tokens,
      signal: controller.signal,
    });
    const message = result.toolCalls?.length
      ? { tool_calls: result.toolCalls }
      : { content: result.suggestion || '' };
    return new Response(`${JSON.stringify({ message, done: true })}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'X-Mira-Recovery': 'managed',
      },
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abort);
  }
}

export async function deepSeekChatResponse(body, signal, { recovery = '' } = {}) {
  const result = await requestDeepSeekChat({
    messages: body?.messages,
    systemPrompt: composeMiraSystemPrompt(body?.systemPrompt),
    tools: sanitizeTools(body?.tools),
    maxTokens: body?.max_tokens,
    think: body?.think === true,
    signal,
  });
  const message = {
    ...(result.answer ? { content: result.answer } : {}),
    ...(result.thinking ? { thinking: result.thinking } : {}),
    ...(result.toolCalls?.length ? { tool_calls: result.toolCalls } : {}),
  };
  return new Response(`${JSON.stringify({ model: result.model, message, done: true, done_reason: result.finishReason })}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Mira-Provider': 'deepseek',
      ...(recovery ? { 'X-Mira-Recovery': recovery } : {}),
    },
  });
}

export async function miraChatResponse(body, signal, { recovery = '' } = {}) {
  if (!MIRA_CHAT_API_URL) throw new Error('MIRA chat provider is not configured.');
  const chatMessages = normalizeMessages(body?.messages, body?.systemPrompt, body?.requestClass);
  if (!chatMessages.length) throw new Error('MIRA chat requires messages.');
  const { tools: preparedTools } = prepareDeepSeekTools(sanitizeTools(body?.tools));
  // MIRA:latest only separates reasoning from the final answer when streaming.
  // Non-streaming aggregation returns empty `content`, so always stream and
  // proxy the OpenAI-style SSE chunks to the client parser.
  const payload = {
    model: MIRA_CHAT_MODEL,
    messages: chatMessages,
    stream: true,
    temperature: CHAT_TEMPERATURE,
    ...(preparedTools.length ? { tools: preparedTools, tool_choice: 'auto' } : {}),
  };

  const attemptController = new AbortController();
  const abortAttempt = () => attemptController.abort();
  if (signal?.aborted) abortAttempt();
  else signal?.addEventListener?.('abort', abortAttempt, { once: true });
  const connectTimer = setTimeout(() => attemptController.abort(), MIRA_PRIMARY_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(MIRA_CHAT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '1',
        ...(MIRA_CHAT_API_KEY ? { Authorization: `Bearer ${MIRA_CHAT_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: attemptController.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (attemptController.signal.aborted) {
      const timeoutError = new Error('The MIRA provider did not begin responding in time.');
      timeoutError.code = 'mira_connect_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(connectTimer);
    signal?.removeEventListener?.('abort', abortAttempt);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    const error = new Error(detail || `MIRA chat request failed (${upstream.status}).`);
    error.status = upstream.status;
    error.code = 'mira_upstream_error';
    throw error;
  }

  // Fail over immediately when the ngrok gateway buffers an HTML error page or
  // a JSON error into a 200 response instead of an upstream error status.
  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/event-stream')) {
    const detail = await upstream.text().catch(() => '');
    const error = new Error(detail.slice(0, 300) || `MIRA chat returned an unexpected ${contentType || 'response'}.`);
    error.status = upstream.status;
    error.code = 'mira_invalid_response';
    throw error;
  }

  const reader = upstream.body?.getReader();
  if (!reader) {
    const error = new Error('The MIRA provider returned an empty response body.');
    error.code = 'mira_empty_response';
    throw error;
  }

  // Peek the first SSE chunk so a "service unavailable" body is detected and
  // rerouted to DeepSeek before any bytes reach the client.
  let firstChunk = null;
  try {
    const first = await readUpstreamChunk(reader, MIRA_FIRST_CHUNK_TIMEOUT_MS);
    if (first.done) {
      const error = new Error('The MIRA provider returned an empty response body.');
      error.code = 'mira_empty_response';
      throw error;
    }
    firstChunk = first.value;
  } catch (error) {
    if (signal?.aborted) throw error;
    await reader.cancel(error).catch(() => {});
    throw error;
  }

  const firstChunkText = new TextDecoder().decode(firstChunk).trim();
  const errorLikeChunk = /<html|<!doctype|\{"error"|"error"\s*:|service (?:is )?(?:temporarily )?unavailable|temporarily unavailable|tunnel .*not found|bad gateway/i
    .test(firstChunkText);
  if (errorLikeChunk && !firstChunkText.startsWith('data:')) {
    await reader.cancel(new Error(firstChunkText.slice(0, 200))).catch(() => {});
    const error = new Error(firstChunkText.slice(0, 200) || 'The MIRA provider returned an invalid stream.');
    error.code = 'mira_invalid_response';
    throw error;
  }

  const proxiedBody = new ReadableStream({
    async start(streamController) {
      const onAbort = () => {
        reader.cancel().catch?.(() => {});
        try { streamController.close(); } catch {}
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      const streamStartedAt = Date.now();
      let wroteChunk = false;
      try {
        if (firstChunk) {
          streamController.enqueue(firstChunk);
          wroteChunk = true;
        }
        while (!signal?.aborted) {
          const remainingMs = MIRA_STREAM_TOTAL_MS - (Date.now() - streamStartedAt);
          if (remainingMs <= 0) {
            const error = new Error('The MIRA provider took too long to complete the response.');
            error.code = 'upstream_stream_timeout';
            throw error;
          }
          const { value, done } = await readUpstreamChunk(
            reader,
            Math.min(MIRA_STREAM_IDLE_MS, remainingMs),
          );
          if (done) break;
          wroteChunk = true;
          streamController.enqueue(value);
        }
      } catch (error) {
        if (!signal?.aborted && error?.code === 'upstream_stream_timeout' && !wroteChunk) {
          const payload = `${JSON.stringify({
            error: error.message,
            code: error.code,
            done: true,
          })}\n`;
          try { streamController.enqueue(new TextEncoder().encode(payload)); } catch {}
        }
        try { await reader.cancel(error); } catch {}
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
        try { streamController.close(); } catch {}
      }
    },
    cancel() {
      reader.cancel().catch?.(() => {});
    },
  });

  return new Response(proxiedBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Mira-Provider': 'mira',
      ...(recovery ? { 'X-Mira-Recovery': recovery } : {}),
    },
  });
}

export async function POST(req) {
  const guarded = guardRequest(req, { limit: 24, windowMs: 60_000, key: 'chat' });
  if (guarded) return guarded;
  let requestId = '';
  let body = null;
  let requestController = null;
  let removeClientAbortListener = () => {};
  let managedFallbackAttempted = false;
  let webDeepSeekFallbackAttempted = false;
  try {
    const contentLength = Number(req.headers?.get?.('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Request body is too large.' }, 413);

    body = await req.json();
    const desktopCodingRequest = body?.desktopCoding === true
      && req.headers?.get?.('x-mira-desktop') === '1';
    requestId = String(body?.requestId || '').trim();
    if (body?.action === 'cancel') {
      const controller = ACTIVE_CHAT_REQUESTS.get(requestId);
      if (controller && !controller.signal.aborted) controller.abort();
      ACTIVE_CHAT_REQUESTS.delete(requestId);
      return jsonResponse({ cancelled: Boolean(controller) });
    }

    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'Messages are required.' }, 400);
    }
    const containsImages = (Array.isArray(body?.images) && body.images.length > 0)
      || body.messages.some((message) => Array.isArray(message?.images) && message.images.length > 0);
    if (containsImages) {
      return jsonResponse({ error: 'Raw images are accepted only by /api/analyze.' }, 400);
    }
    if (JSON.stringify(body).length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body is too large.' }, 413);
    }

    const controller = new AbortController();
    requestController = controller;
    if (requestId) ACTIVE_CHAT_REQUESTS.set(requestId, controller);
    const onClientAbort = () => controller.abort();
    removeClientAbortListener = () => req.signal?.removeEventListener?.('abort', onClientAbort);
    if (req.signal?.aborted) onClientAbort();
    else req.signal?.addEventListener?.('abort', onClientAbort, { once: true });

    const finishEarlyResponse = (response) => {
      removeClientAbortListener();
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      return response;
    };

    const tryManagedFallback = async () => {
      if (
        !desktopCodingRequest
        || managedFallbackAttempted
        || !String(process.env.POLLINATIONS_API_KEY || '').trim()
      ) return null;
      managedFallbackAttempted = true;
      try {
        return await managedFallbackResponse(body, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || req.signal?.aborted) throw error;
        return null;
      }
    };

    const tryWebDeepSeekFallback = async (reason = 'unavailable') => {
      if (
        desktopCodingRequest
        || webDeepSeekFallbackAttempted
        || !String(process.env.DEEPSEEK_API_KEY || '').trim()
        || Date.now() < webDeepSeekUnavailableUntil
        || controller.signal.aborted
        || req.signal?.aborted
      ) return null;
      webDeepSeekFallbackAttempted = true;
      try {
        const fallbackSignal = typeof AbortSignal.any === 'function'
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(16_000)])
          : controller.signal;
        const response = await deepSeekChatResponse(body, fallbackSignal, {
          recovery: reason,
        });
        webDeepSeekUnavailableUntil = 0;
        return response;
      } catch (error) {
        if (controller.signal.aborted || req.signal?.aborted) throw error;
        webDeepSeekUnavailableUntil = Date.now() + DEEPSEEK_FAILURE_COOLDOWN_MS;
        return null;
      }
    };

    if (
      desktopCodingRequest
      && prefersDeepSeekDesktopCoding()
      && String(process.env.DEEPSEEK_API_KEY || '').trim()
      && Date.now() >= deepSeekUnavailableUntil
    ) {
      try {
        const deepSeekSignal = typeof AbortSignal.any === 'function'
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])
          : controller.signal;
        const response = await deepSeekChatResponse(body, deepSeekSignal);
        deepSeekUnavailableUntil = 0;
        return finishEarlyResponse(response);
      } catch (error) {
        if (controller.signal.aborted || req.signal?.aborted) throw error;
        deepSeekUnavailableUntil = Date.now() + DEEPSEEK_FAILURE_COOLDOWN_MS;
        // Pollinations is the secondary provider for desktop coding only.
        const managedResponse = await tryManagedFallback();
        if (managedResponse) return finishEarlyResponse(managedResponse);
      }
    }
    if (desktopCodingRequest) {
      const managedResponse = await tryManagedFallback();
      if (managedResponse) return finishEarlyResponse(managedResponse);
      return finishEarlyResponse(jsonResponse({
        error: 'Desktop coding completion providers are temporarily unavailable.',
        code: 'desktop_coding_unavailable',
        retryable: true,
      }, 503));
    }

    // MIRA is mandatory for web chat/task traffic. DeepSeek is only an outage
    // fallback after MIRA has been attempted and failed with a retryable
    // transport, timeout, rate-limit, or upstream-service error.
    if (!MIRA_CHAT_API_URL || !MIRA_CHAT_API_KEY) {
      return finishEarlyResponse(miraConfigurationError());
    }

    if (MIRA_CHAT_API_URL && Date.now() >= miraUnavailableUntil) {
      try {
        const response = await requestMiraPrimary(body, controller.signal);
        miraUnavailableUntil = 0;
        return finishEarlyResponse(response);
      } catch (error) {
        if (controller.signal.aborted || req.signal?.aborted) throw error;
        if (!isMiraFallbackEligible(error)) {
          return finishEarlyResponse(miraConfigurationError(error));
        }
        miraUnavailableUntil = Date.now() + MIRA_FAILURE_COOLDOWN_MS;
        const fallback = await tryWebDeepSeekFallback('mira-retryable-outage');
        if (fallback) return finishEarlyResponse(fallback);
      }
    }

    const fallback = await tryWebDeepSeekFallback('mira-circuit-open');
    if (fallback) return finishEarlyResponse(fallback);

    return finishEarlyResponse(jsonResponse({
      error: 'The chat service is temporarily unavailable. Please try again shortly.',
      code: 'chat_service_unavailable',
      retryable: true,
    }, 503));
  } catch (error) {
    removeClientAbortListener();
    if (requestController && !requestController.signal.aborted && req.signal?.aborted) {
      requestController.abort();
    }
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    const aborted = error?.name === 'AbortError';
    return jsonResponse({ error: aborted ? 'Generation stopped.' : (error?.message || 'Chat request failed.') }, aborted ? 499 : 500);
  }
}

import { parseOllamaKeepAlive } from './ollamaConfig.js';
import { requestDeepSeekChat, requestManagedChat } from './code-assist.js';
import { guardRequest } from './_requestSecurity.js';
import {
  composeMiraSystemPrompt,
  MIRA_IDENTITY_PRIMER,
} from '../src/config/systemPrompt.js';

export const config = { maxDuration: 300 };

const OLLAMA_CHAT_API_URL = String(process.env.OLLAMA_API_URL || '').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 12000);
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.2);
const OLLAMA_TOP_P = Number(process.env.OLLAMA_TOP_P || 0.85);
const OLLAMA_REPEAT_PENALTY = Number(process.env.OLLAMA_REPEAT_PENALTY || 1.05);
const OLLAMA_KEEP_ALIVE = parseOllamaKeepAlive(process.env.OLLAMA_KEEP_ALIVE, -1);
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_TOKENS_CAP = 12000;
const DEFAULT_CHAT_MAX_TOKENS = 4096;
const DEFAULT_TOOL_MAX_TOKENS = 2200;
const DEFAULT_TASK_MAX_TOKENS = 1800;
const UPSTREAM_STREAM_IDLE_MS = 25_000;
const UPSTREAM_STREAM_TOTAL_MS = 110_000;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);
const ALLOWED_TOOL_NAMES = new Set([
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
const MODEL_REGISTRY_CACHE = { expiresAt: 0, selected: null };
const MODEL_REGISTRY_CACHE_TTL_MS = 60 * 1000;
const MAX_MODEL_ATTEMPTS = 2;
const RETRYABLE_UPSTREAM_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEEPSEEK_FAILURE_COOLDOWN_MS = 30 * 1000;
let deepSeekUnavailableUntil = 0;

function prefersDeepSeekDesktopCoding() {
  return String(
    process.env.MIRA_DESKTOP_CODING_PROVIDER
    || process.env.MIRA_CHAT_PROVIDER
    || 'deepseek',
  ).trim().toLowerCase() !== 'pollinations';
}

export function getContextTokens(value = process.env.OLLAMA_CONTEXT_TOKENS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 16384;
  return Math.max(1, Math.round(parsed));
}

export function getAdaptiveContextTokens(messages = [], maxTokens = OLLAMA_MAX_TOKENS, configuredLimit = getContextTokens()) {
  const promptChars = (Array.isArray(messages) ? messages : [])
    .reduce((total, message) => total + String(message?.content || '').length, 0);
  const estimatedPromptTokens = Math.ceil(promptChars / 3.5);
  const outputReserve = Math.max(256, Math.min(512, Number(maxTokens) || 512));
  const required = Math.max(2048, estimatedPromptTokens + outputReserve);
  const rounded = 2 ** Math.ceil(Math.log2(required));
  return Math.max(1, Math.min(getContextTokens(configuredLimit), rounded));
}

export function getUpstreamStartTimeoutMs(value = process.env.OLLAMA_START_TIMEOUT_MS) {
  const parsed = Number(value || 50000);
  if (!Number.isFinite(parsed)) return 50000;
  return Math.max(15000, Math.min(55000, Math.round(parsed)));
}

export function getFailoverStartTimeoutMs() {
  // A failed large model can take most of one start window before Ollama
  // reports that its runner was killed. Reserve a second bounded window for
  // the already-installed registry fallback while remaining below the
  // browser's 65-second response-header timeout.
  return 60_000;
}

export function getUpstreamConnectTimeoutMs(value = process.env.OLLAMA_CONNECT_TIMEOUT_MS) {
  // Hostinger can buffer the Ollama response headers until a cold model has
  // finished loading. The installed fallback currently needs ~40-45 seconds
  // on a cold CPU start, so a shorter header timeout aborts a healthy runner.
  // Keep this below the overall 60-second request budget so the API still has
  // a deterministic upper bound and can return a useful recovery response.
  const parsed = Number(value || 55000);
  if (!Number.isFinite(parsed)) return 55000;
  return Math.max(15000, Math.min(55000, Math.round(parsed)));
}

export function getRequestMaxTokens(body = {}) {
  const requested = Number(body?.max_tokens);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(MAX_TOKENS_CAP, Math.round(requested));
  }
  if (body?.requestClass === 'task') return DEFAULT_TASK_MAX_TOKENS;
  if (Array.isArray(body?.tools) && body.tools.length > 0) return DEFAULT_TOOL_MAX_TOKENS;
  return Math.min(MAX_TOKENS_CAP, Math.max(512, OLLAMA_MAX_TOKENS || DEFAULT_CHAT_MAX_TOKENS), DEFAULT_CHAT_MAX_TOKENS);
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

function getOllamaBaseUrl(chatUrl = '') {
  return String(chatUrl || '').trim().replace(/\/api\/.*/i, '');
}

function registryModelName(entry) {
  return String(entry?.name || entry?.model || '').trim();
}

function registryModelSize(entry) {
  const size = Number(entry?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function modelSelectionScore(entry, residentNames = new Set()) {
  const name = registryModelName(entry);
  const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
  const sizeGb = registryModelSize(entry) / 1_000_000_000;
  let score = 0;
  if (residentNames.has(name)) score += 1000;
  if (capabilities.includes('thinking')) score += 25;
  if (capabilities.includes('tools')) score += 25;
  // Prefer the dedicated text model when both runners are equally viable.
  if (!capabilities.includes('vision')) score += 80;
  // On a cold CPU-only host, loading a model larger than available system RAM
  // kills llama-server before failover can begin. Weight size strongly enough
  // for the smaller completion-capable registry model to win a cold start;
  // residency (+1000) and an explicit configured preference still override it.
  score -= Math.min(80, sizeGb * 3.5);
  return score;
}

export function selectRegistryModel(models = [], preferredModel = '', {
  residentNames = [],
  excludedNames = [],
} = {}) {
  if (!Array.isArray(models)) return null;
  const excluded = new Set(excludedNames);
  const residents = new Set(residentNames);
  const candidates = models.filter((entry) => {
    const name = registryModelName(entry);
    if (!name) return false;
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return capabilities.length === 0 || capabilities.includes('completion');
  });
  const usable = candidates.filter((entry) => !excluded.has(registryModelName(entry)));
  if (!usable.length) return null;
  const preferred = String(preferredModel || '').trim();
  const preferredEntry = preferred
    ? usable.find((entry) => registryModelName(entry) === preferred)
    : null;
  const positiveSizes = usable.map(registryModelSize).filter((size) => size > 0);
  const smallestSize = positiveSizes.length ? Math.min(...positiveSizes) : 0;
  const preferredIsColdAndOversized = Boolean(
    preferredEntry
    && !residents.has(registryModelName(preferredEntry))
    && smallestSize > 0
    && registryModelSize(preferredEntry) > smallestSize * 2,
  );
  const selected = (preferredEntry && !preferredIsColdAndOversized ? preferredEntry : null)
    || [...usable].sort((left, right) => (
    modelSelectionScore(right, residents) - modelSelectionScore(left, residents)
      || registryModelSize(left) - registryModelSize(right)
  ))[0];
  return {
    name: registryModelName(selected),
    capabilities: Array.isArray(selected.capabilities) ? selected.capabilities : [],
  };
}

function markModelFailure(model) {
  const name = registryModelName(model);
  if (!name) return;
  // A provider failure belongs to the current request only. The previous
  // process-wide cooldown allowed one user's transient 503 to quarantine all
  // completion models for every later task handled by the same function.
  if (MODEL_REGISTRY_CACHE.selected?.name === name) {
    MODEL_REGISTRY_CACHE.selected = null;
    MODEL_REGISTRY_CACHE.expiresAt = 0;
  }
}

async function fetchRegistryModel(signal, { forceRefresh = false, excludedNames = [] } = {}) {
  const now = Date.now();
  if (!forceRefresh && MODEL_REGISTRY_CACHE.selected && MODEL_REGISTRY_CACHE.expiresAt > now) {
    return MODEL_REGISTRY_CACHE.selected;
  }

  const baseUrl = getOllamaBaseUrl(OLLAMA_CHAT_API_URL);
  if (!baseUrl) throw new Error('OLLAMA_API_URL is not configured.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const residencySignal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
      : controller.signal;
    const [tagsResponse, psResponse] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, { signal: controller.signal }),
      fetch(`${baseUrl}/api/ps`, { signal: residencySignal }).catch(() => null),
    ]);
    if (!tagsResponse.ok) throw new Error(`Model registry request failed (${tagsResponse.status}).`);
    const [payload, residency] = await Promise.all([
      tagsResponse.json().catch(() => ({})),
      psResponse?.ok ? psResponse.json().catch(() => ({})) : {},
    ]);
    const residentNames = (Array.isArray(residency?.models) ? residency.models : [])
      .map(registryModelName)
      .filter(Boolean);
    const selected = selectRegistryModel(payload?.models, process.env.OLLAMA_CHAT_MODEL, {
      residentNames,
      excludedNames,
    });
    if (!selected) {
      const unavailableError = new Error('No completion model is currently available.');
      unavailableError.code = 'no_available_model';
      throw unavailableError;
    }
    MODEL_REGISTRY_CACHE.selected = selected;
    MODEL_REGISTRY_CACHE.expiresAt = now + MODEL_REGISTRY_CACHE_TTL_MS;
    return selected;
  } catch (error) {
    if (signal?.aborted) throw error;
    const blocked = new Set(excludedNames);
    if (MODEL_REGISTRY_CACHE.selected && !blocked.has(MODEL_REGISTRY_CACHE.selected.name)) {
      return MODEL_REGISTRY_CACHE.selected;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abort);
  }
}

function normalizeMessages(messages = [], systemPrompt = '') {
  const normalized = (Array.isArray(messages) ? messages : [])
    .slice(-40)
    .map((message) => ({
      role: ALLOWED_ROLES.has(message?.role) ? message.role : 'user',
      content: typeof message?.content === 'string' ? message.content : String(message?.content || ''),
    }))
    .filter((message) => message.content.trim());

  const withoutSystem = normalized.filter((message) => message.role !== 'system');
  return [
    { role: 'system', content: composeMiraSystemPrompt(systemPrompt) },
    ...MIRA_IDENTITY_PRIMER,
    ...withoutSystem,
  ];
}

function applyThinkingPreference(messages = [], think, supportsNativeThinking = false) {
  if (typeof think !== 'boolean') return messages;
  const directive = think ? '/think' : '/no_think';
  const target = [...messages].reverse().findIndex((message) => message.role === 'user');
  if (target < 0) return messages;
  const index = messages.length - 1 - target;
  return messages.map((message, messageIndex) => (
    messageIndex === index && !String(message.content || '').trimStart().startsWith(directive)
      ? { ...message, content: `${directive}\n${message.content}` }
      : message
  ));
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

export function buildUpstreamPayload({
  registryModel,
  messages = [],
  systemPrompt = '',
  think = true,
  maxTokens = OLLAMA_MAX_TOKENS,
  tools = [],
} = {}) {
  const safeMax = Math.max(1, Math.min(Number(maxTokens) || OLLAMA_MAX_TOKENS, MAX_TOKENS_CAP));
  const supportsNativeThinking = registryModel?.capabilities?.includes('thinking');
  const safeTools = sanitizeTools(tools);
  const normalizedMessages = applyThinkingPreference(
    normalizeMessages(messages, systemPrompt),
    think,
    supportsNativeThinking,
  );
  // Qwen3-VL in the current Ollama runtime ignores both `think: false` and
  // `/no_think`, consuming the full token budget in hidden reasoning and then
  // returning an empty answer. An assistant prefill closes that channel and
  // makes the model answer immediately. Keep native-tool turns untouched,
  // because their template needs to begin the assistant turn itself.
  const normalized = think === false && supportsNativeThinking && safeTools.length === 0
    ? [...normalizedMessages, { role: 'assistant', content: '</think>\n\n' }]
    : normalizedMessages;
  const options = {
    num_predict: safeMax,
    num_ctx: getAdaptiveContextTokens(normalized, safeMax),
    temperature: OLLAMA_TEMPERATURE,
    top_p: OLLAMA_TOP_P,
    repeat_penalty: OLLAMA_REPEAT_PENALTY,
  };
  const payload = {
    model: registryModel?.name || '',
    messages: normalized,
    stream: true,
    keep_alive: OLLAMA_KEEP_ALIVE,
    options,
  };
  // Some Ollama model manifests (including Qwen3-Coder) expose a tool-aware
  // template but omit `tools` from /api/tags. Ollama still accepts and parses
  // native calls correctly, so pass only our allowlisted schemas whenever the
  // selected model supports completion.
  if (safeTools.length) payload.tools = safeTools;
  // Ollama accepts the thinking preference even when a model manifest omits
  // the `thinking` capability. The live Qwen registry does exactly that; if
  // we rely on the tag alone, `/no_think` can be ignored and a greeting burns
  // its entire response budget on hidden reasoning with no visible answer.
  // Keep the prompt directive for older templates and always send the native
  // switch as the authoritative preference.
  if (typeof think === 'boolean') payload.think = think;
  return payload;
}

async function fetchUpstream(payload, signal) {
  if (!OLLAMA_CHAT_API_URL) throw new Error('OLLAMA_API_URL is not configured.');
  const attemptController = new AbortController();
  let connectTimedOut = false;
  const abortAttempt = () => attemptController.abort();
  if (signal?.aborted) abortAttempt();
  else signal?.addEventListener?.('abort', abortAttempt, { once: true });
  const connectTimer = setTimeout(() => {
    connectTimedOut = true;
    attemptController.abort();
  }, getUpstreamConnectTimeoutMs());
  try {
    return await fetch(OLLAMA_CHAT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: attemptController.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (connectTimedOut) {
      const timeoutError = new Error('The model server did not begin the response in time.');
      timeoutError.code = 'upstream_connect_timeout';
      throw timeoutError;
    }
    if (error?.name === 'AbortError') throw error;
    const connectionError = new Error('The model server closed the connection before responding.');
    connectionError.code = 'upstream_connection_closed';
    connectionError.cause = error;
    throw connectionError;
  } finally {
    clearTimeout(connectTimer);
    signal?.removeEventListener?.('abort', abortAttempt);
  }
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

export async function deepSeekChatResponse(body, signal) {
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
  return new Response(`${JSON.stringify({ model: result.model, message, done: true })}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Mira-Provider': 'deepseek',
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
  let upstreamStartTimedOut = false;
  let upstreamStartTimer = null;
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
        clearTimeout(upstreamStartTimer);
        upstreamStartTimer = null;
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

    // Web chat and web task workflows use Ollama exclusively.
    upstreamStartTimer = setTimeout(() => {
      upstreamStartTimedOut = true;
      controller.abort();
    }, getFailoverStartTimeoutMs());
    let upstream;
    let registryModel = await fetchRegistryModel(controller.signal);
    let modelFailoverUsed = false;
    let lastUpstreamError = null;
    const attemptedModels = [];
    for (let modelAttempt = 0; modelAttempt < MAX_MODEL_ATTEMPTS && registryModel; modelAttempt += 1) {
      attemptedModels.push(registryModel.name);
      const upstreamPayload = buildUpstreamPayload({
        registryModel,
        messages: body.messages,
        systemPrompt: body.systemPrompt,
        think: body.think,
        maxTokens: getRequestMaxTokens(body),
        tools: body.tools,
      });
      try {
        upstream = await fetchUpstream(upstreamPayload, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || req.signal?.aborted) throw error;
        lastUpstreamError = error;
        markModelFailure(registryModel);
      }

      if (upstream?.ok) break;
      if (upstream) {
        const detail = await upstream.text().catch(() => '');
        const upstreamError = new Error(detail || `Upstream request failed (${upstream.status}).`);
        upstreamError.status = upstream.status;
        upstreamError.code = 'upstream_http_error';
        lastUpstreamError = upstreamError;
        if (RETRYABLE_UPSTREAM_STATUS.has(upstream.status)) markModelFailure(registryModel);
      }

      const canTryAnotherModel = modelAttempt === 0 && (
        !upstream || RETRYABLE_UPSTREAM_STATUS.has(upstream.status)
      );
      if (!canTryAnotherModel) break;
      registryModel = await fetchRegistryModel(controller.signal, {
        forceRefresh: true,
        excludedNames: attemptedModels,
      }).catch(() => null);
      if (registryModel) modelFailoverUsed = true;
      upstream = null;
    }

    if (!upstream?.ok) {
      clearTimeout(upstreamStartTimer);
      upstreamStartTimer = null;
      finishEarlyResponse(null);
      const timedOut = lastUpstreamError?.code === 'upstream_connect_timeout';
      return jsonResponse({
        error: timedOut
          ? 'The model is still starting. Please retry shortly.'
          : 'The model service is temporarily unavailable.',
        code: timedOut ? 'upstream_start_timeout' : 'upstream_unavailable',
        retryable: true,
      }, timedOut ? 504 : 503);
    }
    clearTimeout(upstreamStartTimer);
    upstreamStartTimer = null;

    const proxiedBody = new ReadableStream({
      async start(streamController) {
        const reader = upstream.body?.getReader();
        if (!reader) {
          streamController.close();
          return;
        }
        const onAbort = () => {
          reader.cancel().catch?.(() => {});
          try { streamController.close(); } catch {}
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const streamStartedAt = Date.now();
        let wroteChunk = false;
        try {
          while (!controller.signal.aborted) {
            const remainingMs = UPSTREAM_STREAM_TOTAL_MS - (Date.now() - streamStartedAt);
            if (remainingMs <= 0) {
              const error = new Error('The model took too long to complete the response.');
              error.code = 'upstream_stream_timeout';
              throw error;
            }
            const { value, done } = await readUpstreamChunk(
              reader,
              Math.min(UPSTREAM_STREAM_IDLE_MS, remainingMs),
            );
            if (done) break;
            wroteChunk = true;
            streamController.enqueue(value);
          }
        } catch (error) {
          if (!controller.signal.aborted && error?.code === 'upstream_stream_timeout' && !wroteChunk) {
            const payload = `${JSON.stringify({
              error: error.message,
              code: error.code,
              done: true,
            })}\n`;
            try { streamController.enqueue(new TextEncoder().encode(payload)); } catch {}
          }
          try { await reader.cancel(error); } catch {}
        } finally {
          controller.signal.removeEventListener('abort', onAbort);
          req.signal?.removeEventListener?.('abort', onClientAbort);
          if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
          try { streamController.close(); } catch {}
        }
      },
      cancel() {
        controller.abort();
        if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      },
    });

    return new Response(proxiedBody, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Mira-Provider': 'ollama',
        ...(modelFailoverUsed ? { 'X-Mira-Model-Failover': '1' } : {}),
      },
    });
  } catch (error) {
    if (upstreamStartTimer) clearTimeout(upstreamStartTimer);
    removeClientAbortListener();
    if (requestController && !requestController.signal.aborted && req.signal?.aborted) {
      requestController.abort();
    }
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    if (upstreamStartTimedOut) {
      return jsonResponse({
        error: 'The model is busy and did not begin responding in time.',
        code: 'model_start_timeout',
      }, 504);
    }
    if (error?.code === 'no_available_model') {
      return jsonResponse({
        error: 'No Ollama completion model is currently available.',
        code: 'no_completion_model',
        retryable: true,
      }, 503);
    }
    const aborted = error?.name === 'AbortError';
    return jsonResponse({ error: aborted ? 'Generation stopped.' : (error?.message || 'Chat request failed.') }, aborted ? 499 : 500);
  }
}

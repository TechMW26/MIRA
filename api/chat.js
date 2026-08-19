import { parseOllamaKeepAlive } from './ollamaConfig.js';
import { requestManagedChat } from './code-assist.js';

export const config = { maxDuration: 300 };

const OLLAMA_CHAT_API_URL = String(process.env.OLLAMA_API_URL || '').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 12000);
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.2);
const OLLAMA_TOP_P = Number(process.env.OLLAMA_TOP_P || 0.85);
const OLLAMA_REPEAT_PENALTY = Number(process.env.OLLAMA_REPEAT_PENALTY || 1.05);
const OLLAMA_KEEP_ALIVE = parseOllamaKeepAlive(process.env.OLLAMA_KEEP_ALIVE, -1);
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_TOKENS_CAP = 12000;
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
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.replace',
  'filesystem.search',
  'workspace.index',
  'workspace.search',
  'workspace.validate',
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
const MODEL_REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000;

export function getContextTokens(value = process.env.OLLAMA_CONTEXT_TOKENS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 16384;
  return Math.max(1, Math.round(parsed));
}

export function getUpstreamStartTimeoutMs(value = process.env.OLLAMA_START_TIMEOUT_MS) {
  const parsed = Number(value || 50000);
  if (!Number.isFinite(parsed)) return 50000;
  return Math.max(15000, Math.min(55000, Math.round(parsed)));
}

export function getUpstreamConnectTimeoutMs(value = process.env.OLLAMA_CONNECT_TIMEOUT_MS) {
  const parsed = Number(value || 8000);
  if (!Number.isFinite(parsed)) return 8000;
  return Math.max(3000, Math.min(20000, Math.round(parsed)));
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

export function selectRegistryModel(models = [], preferredModel = '') {
  if (!Array.isArray(models)) return null;
  const usable = models.filter((entry) => {
    const name = registryModelName(entry);
    if (!name) return false;
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return capabilities.length === 0 || capabilities.includes('completion');
  });
  if (!usable.length) return null;
  const preferred = String(preferredModel || '').trim();
  const selected = (preferred
    ? usable.find((entry) => registryModelName(entry) === preferred)
    : null) || usable.find((entry) => {
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return capabilities.includes('thinking') && !capabilities.includes('vision');
  }) || usable.find((entry) => {
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return !capabilities.includes('vision');
  }) || usable[0];
  return {
    name: registryModelName(selected),
    capabilities: Array.isArray(selected.capabilities) ? selected.capabilities : [],
  };
}

async function fetchRegistryModel(signal) {
  const now = Date.now();
  if (MODEL_REGISTRY_CACHE.selected && MODEL_REGISTRY_CACHE.expiresAt > now) {
    return MODEL_REGISTRY_CACHE.selected;
  }

  const baseUrl = getOllamaBaseUrl(OLLAMA_CHAT_API_URL);
  if (!baseUrl) throw new Error('OLLAMA_API_URL is not configured.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Model registry request failed (${response.status}).`);
    const payload = await response.json().catch(() => ({}));
    const selected = selectRegistryModel(payload?.models, process.env.OLLAMA_CHAT_MODEL);
    if (!selected) throw new Error('The model registry returned no completion model.');
    MODEL_REGISTRY_CACHE.selected = selected;
    MODEL_REGISTRY_CACHE.expiresAt = now + MODEL_REGISTRY_CACHE_TTL_MS;
    return selected;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (MODEL_REGISTRY_CACHE.selected) return MODEL_REGISTRY_CACHE.selected;
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
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...withoutSystem,
  ];
}

function applyThinkingPreference(messages = [], think, supportsNativeThinking = false) {
  if (typeof think !== 'boolean' || supportsNativeThinking) return messages;
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
  const normalized = applyThinkingPreference(
    normalizeMessages(messages, systemPrompt),
    think,
    supportsNativeThinking,
  );
  const options = {
    num_predict: safeMax,
    num_ctx: getContextTokens(),
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
  const safeTools = sanitizeTools(tools);
  // Some Ollama model manifests (including Qwen3-Coder) expose a tool-aware
  // template but omit `tools` from /api/tags. Ollama still accepts and parses
  // native calls correctly, so pass only our allowlisted schemas whenever the
  // selected model supports completion.
  if (safeTools.length) payload.tools = safeTools;
  // /api/tags may omit capabilities even when the selected model supports
  // reasoning. Preserve an explicit caller preference so simple requests do
  // not spend latency on unnecessary reasoning tokens.
  if (typeof think === 'boolean' && supportsNativeThinking) payload.think = think;
  return payload;
}

async function fetchUpstream(payload, signal) {
  if (!OLLAMA_CHAT_API_URL) throw new Error('OLLAMA_API_URL is not configured.');
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        const timeoutError = new Error('The model server did not accept the request in time.');
        timeoutError.code = 'upstream_connect_timeout';
        throw timeoutError;
      }
      if (error?.name === 'AbortError') throw error;
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      clearTimeout(connectTimer);
      signal?.removeEventListener?.('abort', abortAttempt);
    }
  }
  throw lastError || new Error('The model server is unreachable.');
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
      systemPrompt: body?.systemPrompt,
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

export async function POST(req) {
  let requestId = '';
  let upstreamStartTimedOut = false;
  let upstreamStartTimer = null;
  try {
    const contentLength = Number(req.headers?.get?.('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Request body is too large.' }, 413);

    const body = await req.json();
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
    if (requestId) ACTIVE_CHAT_REQUESTS.set(requestId, controller);
    const onClientAbort = () => controller.abort();
    if (req.signal?.aborted) onClientAbort();
    else req.signal?.addEventListener?.('abort', onClientAbort, { once: true });

    upstreamStartTimer = setTimeout(() => {
      upstreamStartTimedOut = true;
      controller.abort();
    }, getUpstreamStartTimeoutMs());
    const registryModel = await fetchRegistryModel(controller.signal);
    const upstreamPayload = buildUpstreamPayload({
      registryModel,
      messages: body.messages,
      systemPrompt: body.systemPrompt,
      think: body.think,
      maxTokens: body.max_tokens,
      tools: body.tools,
    });
    let upstream;
    try {
      upstream = await fetchUpstream(upstreamPayload, controller.signal);
    } catch (error) {
      clearTimeout(upstreamStartTimer);
      upstreamStartTimer = null;
      req.signal?.removeEventListener?.('abort', onClientAbort);
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      if (controller.signal.aborted || req.signal?.aborted) throw error;
      return await managedFallbackResponse(body, req.signal);
    }
    clearTimeout(upstreamStartTimer);
    upstreamStartTimer = null;
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      req.signal?.removeEventListener?.('abort', onClientAbort);
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      if ([500, 502, 503, 504].includes(upstream.status)) {
        try {
          return await managedFallbackResponse(body, req.signal);
        } catch {
          // Return the original upstream error when both providers are unavailable.
        }
      }
      return jsonResponse({ error: detail || `Upstream request failed (${upstream.status}).` }, 502);
    }

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
        try {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            streamController.enqueue(value);
          }
        } catch {
          // The client or upstream may close a streaming connection normally.
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
      },
    });
  } catch (error) {
    if (upstreamStartTimer) clearTimeout(upstreamStartTimer);
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    if (upstreamStartTimedOut) {
      return jsonResponse({
        error: 'The model is busy and did not begin responding in time.',
        code: 'model_start_timeout',
      }, 504);
    }
    const aborted = error?.name === 'AbortError';
    return jsonResponse({ error: aborted ? 'Generation stopped.' : (error?.message || 'Chat request failed.') }, aborted ? 499 : 500);
  }
}

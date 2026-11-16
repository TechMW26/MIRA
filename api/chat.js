import { parseOllamaKeepAlive } from './ollamaConfig.js';

export const config = { maxDuration: 300 };

const OLLAMA_CHAT_API_URL = String(process.env.OLLAMA_API_URL || '').trim();
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
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
  'filesystem.search',
  'shell.run',
  'test.run',
  'git.status',
  'git.diff',
]);
const ACTIVE_CHAT_REQUESTS = new Map();
// Cancels are delivered as keepalive/beacon POSTs, so they can land after the
// request they target has already finished. Remember recent cancellations so a
// late-arriving cancel is never mistaken for "abort the current stream" — it
// only ever cancels the exact requestId it names.
const RECENTLY_CANCELLED = new Map();
const RECENTLY_CANCELLED_TTL_MS = 60 * 1000;

function rememberCancelled(requestId) {
  if (!requestId) return;
  const now = Date.now();
  if (RECENTLY_CANCELLED.size > 200) {
    for (const [id, at] of RECENTLY_CANCELLED) {
      if (now - at > RECENTLY_CANCELLED_TTL_MS) RECENTLY_CANCELLED.delete(id);
    }
  }
  RECENTLY_CANCELLED.set(requestId, now);
}

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

const REACHABILITY_CACHE = { checkedAt: 0, reachable: true };
const REACHABILITY_CACHE_TTL_MS = 5 * 1000;

// Returns true when the upstream host cannot be reached at the connection
// level at all. Bounded to a brief window so a merely-slow host is never
// misclassified. Uses a short TTL cache so a burst of requests against a dead
// host fail together instead of each waiting the full probe window.
async function probeUpstreamReachability(signal) {
  const baseUrl = getOllamaBaseUrl(OLLAMA_CHAT_API_URL);
  if (!baseUrl) return true;

  const now = Date.now();
  if (now - REACHABILITY_CACHE.checkedAt < REACHABILITY_CACHE_TTL_MS) {
    return !REACHABILITY_CACHE.reachable;
  }

  const controller = new AbortController();
  const abortFromSignal = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromSignal, { once: true });
  const timeout = setTimeout(() => controller.abort(), 2500);
  let reachable = true;
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    reachable = response.ok;
  } catch {
    // Abort (our timeout or client abort) or a connection-level failure both
    // mean "we could not confirm the host is reachable." Distinguish a client
    // abort from a genuine probe timeout so we never report unreachable on a
    // cancelled request.
    if (signal?.aborted) reachable = true;
    else reachable = false;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abortFromSignal);
  }
  REACHABILITY_CACHE.checkedAt = now;
  REACHABILITY_CACHE.reachable = reachable;
  return !reachable;
}

function getDeepSeekApiKey(env = process.env) {
  return String(env?.DEEPSEEK_API_KEY || env?.SCRIPT_NINJA_KEY || '').trim();
}

// DeepSeek exposes an OpenAI-compatible /chat/completions endpoint. The
// client already parses OpenAI SSE (`data: {...}` chunks ending in
// `data: [DONE]`), so we translate the normalized conversation into that
// shape and proxy the stream through unchanged.
export function buildDeepSeekPayload({ messages = [], systemPrompt = '', maxTokens = OLLAMA_MAX_TOKENS } = {}) {
  const normalized = normalizeMessages(messages, systemPrompt);
  return {
    model: DEEPSEEK_MODEL,
    messages: normalized,
    stream: true,
    max_tokens: Math.max(1, Math.min(Number(maxTokens) || OLLAMA_MAX_TOKENS, MAX_TOKENS_CAP)),
    temperature: OLLAMA_TEMPERATURE,
    top_p: OLLAMA_TOP_P,
  };
}

async function fetchDeepSeek(payload, signal) {
  const key = getDeepSeekApiKey();
  if (!key) throw new Error('DEEPSEEK_API_KEY is not configured.');
  return fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
}

function normalizeMessages(messages = [], systemPrompt = '') {
  const parsedLimit = Number(process.env.OLLAMA_HISTORY_MESSAGES);
  const historyLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.max(1, Math.round(parsedLimit))
    : 20;
  const normalized = (Array.isArray(messages) ? messages : [])
    .slice(-historyLimit)
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
  return fetch(OLLAMA_CHAT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

async function streamDeepSeekFallback({ controller, req, requestId, body, onClientAbort }) {
  if (!getDeepSeekApiKey()) {
    req.signal?.removeEventListener?.('abort', onClientAbort);
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    return jsonResponse({
      error: 'The model is currently unreachable. Please try again shortly.',
      code: 'model_unreachable',
    }, 503);
  }

  try {
    const payload = buildDeepSeekPayload({
      messages: body.messages,
      systemPrompt: body.systemPrompt,
      maxTokens: body.max_tokens,
    });
    const upstream = await fetchDeepSeek(payload, controller.signal);
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      req.signal?.removeEventListener?.('abort', onClientAbort);
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      return jsonResponse({ error: detail || `Fallback request failed (${upstream.status}).` }, 502);
    }
    return proxyUpstreamStream({
      upstream,
      controller,
      req,
      requestId,
      onClientAbort,
      defaultContentType: 'text/event-stream',
    });
  } catch (error) {
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    const aborted = error?.name === 'AbortError';
    return jsonResponse(
      { error: aborted ? 'Generation stopped.' : (error?.message || 'Fallback request failed.') },
      aborted ? 499 : 500,
    );
  }
}

function proxyUpstreamStream({ upstream, controller, req, requestId, onClientAbort, defaultContentType = 'application/x-ndjson' }) {
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
      'Content-Type': upstream.headers.get('Content-Type') || defaultContentType,
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
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
      rememberCancelled(requestId);
      return jsonResponse({ cancelled: Boolean(controller) });
    }

    // A request whose id was already cancelled must not start a fresh stream.
    if (requestId && RECENTLY_CANCELLED.has(requestId)) {
      RECENTLY_CANCELLED.delete(requestId);
      return jsonResponse({ error: 'Request was cancelled.', code: 'request_cancelled' }, 499);
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

    // Fast fail when the upstream host is completely unreachable (connection
    // never establishes / no response at all). This is the only case we
    // short-circuit; a host that is merely slow to load or stream a model
    // still follows the existing path unchanged, so no legitimate slow
    // response is affected.
    const unreachable = await probeUpstreamReachability(controller.signal);
    if (unreachable) {
      return streamDeepSeekFallback({
        controller,
        req,
        requestId,
        body,
        onClientAbort,
      });
    }

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
    const upstream = await fetchUpstream(upstreamPayload, controller.signal);
    clearTimeout(upstreamStartTimer);
    upstreamStartTimer = null;
    if (!upstream.ok) {
      return streamDeepSeekFallback({
        controller,
        req,
        requestId,
        body,
        onClientAbort,
      });
    }

    return proxyUpstreamStream({ upstream, controller, req, requestId, onClientAbort });
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

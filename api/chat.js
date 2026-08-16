export const config = { maxDuration: 300 };

const OLLAMA_CHAT_API_URL = String(process.env.OLLAMA_API_URL || '').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 12000);
const OLLAMA_CONTEXT_TOKENS = Number(process.env.OLLAMA_CONTEXT_TOKENS || 0);
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.2);
const OLLAMA_TOP_P = Number(process.env.OLLAMA_TOP_P || 0.85);
const OLLAMA_REPEAT_PENALTY = Number(process.env.OLLAMA_REPEAT_PENALTY || 1.2);
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
]);
const ACTIVE_CHAT_REQUESTS = new Map();
const MODEL_REGISTRY_CACHE = { expiresAt: 0, selected: null };

const IDENTITY_PRIMER = [
  { role: 'user', content: 'Quick check before we start: who are you?' },
  { role: 'assistant', content: 'I am Mira, an AI assistant built by MW FutureTech. How can I help?' },
];

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

export function selectRegistryModel(models = []) {
  if (!Array.isArray(models)) return null;
  const usable = models.find((entry) => {
    const name = registryModelName(entry);
    if (!name) return false;
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return capabilities.length === 0 || capabilities.includes('completion');
  });
  if (!usable) return null;
  return {
    name: registryModelName(usable),
    capabilities: Array.isArray(usable.capabilities) ? usable.capabilities : [],
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
    const selected = selectRegistryModel(payload?.models);
    if (!selected) throw new Error('The model registry returned no completion model.');
    MODEL_REGISTRY_CACHE.selected = selected;
    MODEL_REGISTRY_CACHE.expiresAt = now + 30_000;
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
    ...IDENTITY_PRIMER,
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

export function buildUpstreamPayload({
  registryModel,
  messages = [],
  systemPrompt = '',
  think = true,
  maxTokens = OLLAMA_MAX_TOKENS,
  tools = [],
} = {}) {
  const safeMax = Math.max(1, Math.min(Number(maxTokens) || OLLAMA_MAX_TOKENS, MAX_TOKENS_CAP));
  const normalized = normalizeMessages(messages, systemPrompt);
  const options = {
    num_predict: safeMax,
    temperature: OLLAMA_TEMPERATURE,
    top_p: OLLAMA_TOP_P,
    repeat_penalty: OLLAMA_REPEAT_PENALTY,
  };
  if (OLLAMA_CONTEXT_TOKENS > 0) options.num_ctx = OLLAMA_CONTEXT_TOKENS;

  const payload = {
    model: registryModel?.name || '',
    messages: normalized,
    stream: true,
    options,
  };
  const safeTools = sanitizeTools(tools);
  if (registryModel?.capabilities?.includes('tools') && safeTools.length) payload.tools = safeTools;
  if (registryModel?.capabilities?.includes('thinking')) payload.think = think !== false;
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

export async function POST(req) {
  let requestId = '';
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
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
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
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
    const aborted = error?.name === 'AbortError';
    return jsonResponse({ error: aborted ? 'Generation stopped.' : (error?.message || 'Chat request failed.') }, aborted ? 499 : 500);
  }
}

export const config = { maxDuration: 60 };

const OLLAMA_API_URL = (process.env.OLLAMA_API_URL || 'http://147.93.102.103:11434/api/generate').trim();
const MIRA_MINI_MODEL = (process.env.MIRA_MINI_MODEL || 'mira-mini').trim();
const MIRA_LITE_MODEL = (process.env.MIRA_LITE_MODEL || 'mira-lite').trim();
const MIRA_SPEC_MODEL = (process.env.MIRA_SPEC_MODEL || 'mira-spec').trim();
const MIRA_VISION_MODEL = (process.env.MIRA_VISION_MODEL || 'mira-vision').trim();
const MIRA_LOCKED_MODEL = (process.env.MIRA_LOCKED_MODEL || 'mira-locked:latest').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 2048);
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 300000);
const ACTIVE_CHAT_REQUEST_TTL_MS = OLLAMA_TIMEOUT_MS + 120000;
const UNRESTRICTED_SIGNAL_RE = /\b(nude|nudity|naked|explicit|uncensored|adult\s*content|erotic|porn|pornographic|xxx|18\+|lewd|sexual\s*content|sex|nsfw|fetish|hardcore|boobs?|breasts?|nipples?|genitals?|penis|vagina|anal|blowjob|handjob|cum|orgasm|hentai)\b/i;
const ACTIVE_CHAT_REQUESTS = new Map();

function resolveModelChoice(requested, hasImages, forceLocked = false) {
  const value = String(requested || 'auto').trim().toLowerCase();
  const isMini = value === 'mini' || value === 'mira-mini' || value === MIRA_MINI_MODEL.toLowerCase();
  const isSpec = value === 'spec' || value === 'mira-spec' || value === MIRA_SPEC_MODEL.toLowerCase();
  const isLite = value === 'lite' || value === 'mira-lite' || value === MIRA_LITE_MODEL.toLowerCase();
  const isLocked = value === 'locked' || value === 'mira-locked' || value === MIRA_LOCKED_MODEL.toLowerCase();
  if (forceLocked) return MIRA_LOCKED_MODEL;
  if (isLocked) return MIRA_LOCKED_MODEL;
  if (isSpec) return MIRA_SPEC_MODEL;
  if (isMini) return hasImages ? MIRA_VISION_MODEL : MIRA_MINI_MODEL;
  if (isLite) return hasImages ? MIRA_VISION_MODEL : MIRA_LITE_MODEL;
  return hasImages ? MIRA_VISION_MODEL : MIRA_LITE_MODEL;
}

function hasUnrestrictedSignals(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role !== 'user') continue;
    return UNRESTRICTED_SIGNAL_RE.test(String(message?.content || ''));
  }
  return false;
}

// Hard caps to prevent DoS / runaway requests.
const MAX_BODY_BYTES = 5 * 1024 * 1024;        // 5 MB request body
const MAX_MESSAGES = 40;                        // history depth
const MAX_TEXT_CONTENT_CHARS = 24_000;          // total chars across a single message
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 12000;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

function toOllamaPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || 'user').toUpperCase();
      const content = typeof message?.content === 'string' ? message.content : String(message?.content || '');
      return `${role}: ${content}`;
    })
    .join('\n\n')
    .trim();
}

function attachImagesToLastUser(messages = [], images = []) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user') {
      list[i] = { ...list[i], images };
      return list;
    }
  }
  list.push({ role: 'user', content: '', images });
  return list;
}

function imageToOllamaBase64(image) {
  const raw = image?.base64 || image?.data || image?.url || '';
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return null;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    return comma >= 0 ? raw.slice(comma + 1) : null;
  }
  return raw;
}

function extractLastUserImages(messages = [], fallbackImages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'user') continue;
    const list = Array.isArray(messages[i].images) ? messages[i].images : [];
    const converted = list.map((img) => imageToOllamaBase64({ data: img })).filter(Boolean);
    if (converted.length) return converted;
  }
  return (Array.isArray(fallbackImages) ? fallbackImages : [])
    .map(imageToOllamaBase64)
    .filter(Boolean);
}

function normalizeMessages(messages = [], systemPrompt) {
  const list = Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [];
  const normalized = list
    .filter((message) => message?.role && message.content != null)
    .map((message) => {
      const role = ALLOWED_ROLES.has(message.role) ? message.role : 'user';
      const content = typeof message.content === 'string'
        ? message.content.slice(0, MAX_TEXT_CONTENT_CHARS)
        : String(message.content || '').slice(0, MAX_TEXT_CONTENT_CHARS);
      return { role, content };
    });

  if (systemPrompt && typeof systemPrompt === 'string') {
    return [
      { role: 'system', content: systemPrompt.slice(0, MAX_TEXT_CONTENT_CHARS) },
      ...normalized.filter((message) => message.role !== 'system'),
    ];
  }
  return normalized;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOllamaWithRetry(payload, requestAbortSignal) {
  const transientStatus = new Set([408, 429, 500, 502, 503, 504]);
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (requestAbortSignal?.aborted) {
      return jsonResponse({ error: 'Generation stopped by user.' }, 499);
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    requestAbortSignal?.addEventListener?.('abort', abortUpstream, { once: true });
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const upstream = await fetch(OLLAMA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);

      if (upstream.ok) return upstream;

      const errorText = await upstream.text().catch(() => '');
      lastError = { status: upstream.status, message: errorText || `Ollama upstream error (${upstream.status}).` };
      if (transientStatus.has(upstream.status) && attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }

      return jsonResponse({ error: `Ollama upstream error (${upstream.status}).` }, upstream.status);
    } catch (err) {
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
      if (requestAbortSignal?.aborted) {
        return jsonResponse({ error: 'Generation stopped by user.' }, 499);
      }
      const message = err?.name === 'AbortError' ? 'Ollama request timed out.' : (err?.message || 'Chat request failed.');
      lastError = { status: 500, message };
      if (attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }
    }
  }

  return jsonResponse({ error: lastError?.message || 'Chat request failed.' }, lastError?.status || 500);
}

export async function POST(req) {
  try {
    // Enforce request body size cap.
    const lengthHeader = Number(req.headers.get?.('content-length') || 0);
    if (lengthHeader && lengthHeader > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large.' }, 413);
    }

    const body = await req.json();
    if (body?.action === 'cancel') {
      const requestId = String(body?.requestId || '').trim();
      if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);
      const controller = ACTIVE_CHAT_REQUESTS.get(requestId);
      if (controller) {
        controller.abort();
        ACTIVE_CHAT_REQUESTS.delete(requestId);
      }
      return jsonResponse({ stopped: true });
    }

    const imageList = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    const toolList = Array.isArray(body.tools) ? body.tools.slice(0, 32) : [];
    const messages = normalizeMessages(body.messages, body.systemPrompt);

    if (messages.length === 0) {
      return jsonResponse({ error: 'At least one chat message is required.' }, 400);
    }

    const requestedMax = Number(body.max_tokens) || OLLAMA_MAX_TOKENS;
    const safeMax = Math.max(1, Math.min(requestedMax, MAX_TOKENS_CAP));
    const promptImages = extractLastUserImages(messages, imageList);
    const hasImages = promptImages.length > 0;
    const forceLocked = hasUnrestrictedSignals(messages);
    const effectiveModel = resolveModelChoice(body.model, hasImages, forceLocked);
    if (!OLLAMA_API_URL) return jsonResponse({ error: 'OLLAMA_API_URL is not configured.' }, 500);
    const requestId = String(body.requestId || '').trim();
    const requestController = new AbortController();
    if (requestId) {
      ACTIVE_CHAT_REQUESTS.set(requestId, requestController);
      setTimeout(() => {
        ACTIVE_CHAT_REQUESTS.delete(requestId);
      }, ACTIVE_CHAT_REQUEST_TTL_MS);
    }

    // Critical: abort the upstream Ollama fetch as soon as the client
    // disconnects (Stop pressed, tab closed, navigation, etc.).
    // Ollama has no per-request cancel endpoint; closing the HTTP request
    // to it is the supported way to stop generation.
    if (req?.signal && typeof req.signal.addEventListener === 'function') {
      const onClientAbort = () => {
        if (!requestController.signal.aborted) requestController.abort();
        if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      };
      if (req.signal.aborted) onClientAbort();
      else req.signal.addEventListener('abort', onClientAbort, { once: true });
    }

    const chatMessages = hasImages
      ? attachImagesToLastUser(messages, promptImages)
      : messages;

    const upstreamOrResponse = await fetchOllamaWithRetry(
      {
        model: effectiveModel,
        messages: chatMessages,
        ...(toolList.length > 0 && effectiveModel !== MIRA_LOCKED_MODEL ? { tools: toolList } : {}),
        ...(typeof body.think === 'boolean' ? { think: body.think } : {}),
        stream: body.stream !== false,
        options: { num_predict: safeMax },
      },
      requestController.signal,
    );

    if (!upstreamOrResponse.ok) {
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      return upstreamOrResponse;
    }
    const upstream = upstreamOrResponse;

    // Re-emit the upstream stream so we can abort it mid-flight when the
    // upstream controller is aborted (closes the upstream socket immediately).
    const proxiedBody = new ReadableStream({
      async start(streamController) {
        const reader = upstream.body?.getReader();
        if (!reader) {
          streamController.close();
          return;
        }
        const onAbort = () => {
          try { reader.cancel(); } catch { /* ignore */ }
          try { streamController.close(); } catch { /* ignore */ }
        };
        if (requestController.signal.aborted) {
          onAbort();
          return;
        }
        requestController.signal.addEventListener('abort', onAbort, { once: true });
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (requestController.signal.aborted) break;
            streamController.enqueue(value);
          }
        } catch {
          // Upstream connection closed or aborted; nothing to recover.
        } finally {
          requestController.signal.removeEventListener?.('abort', onAbort);
          if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
          try { streamController.close(); } catch { /* ignore */ }
        }
      },
      cancel() {
        if (!requestController.signal.aborted) requestController.abort();
        if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      },
    });

    return new Response(proxiedBody, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Chat API error:', err?.message);
    const message = err.name === 'AbortError' ? 'Ollama request timed out.' : 'Chat request failed.';
    return jsonResponse({ error: message }, 500);
  } finally {
    try {
      // Remove any request IDs whose controllers were aborted or no longer active.
      for (const [id, controller] of ACTIVE_CHAT_REQUESTS.entries()) {
        if (!controller || controller.signal.aborted) {
          ACTIVE_CHAT_REQUESTS.delete(id);
        }
      }
    } catch {
      // no-op cleanup guard
    }
  }
}
// Vercel hard cap: Hobby = 60s, Pro = 300s, Enterprise = 900s.
// Reasoning streams (especially with `think`) can run
// well past 60s, so we ask for the maximum the plan allows. Vercel clamps this
// down silently if the plan can't grant it — no deployment error.
export const config = { maxDuration: 300 };

const CHAT_API_URL = (process.env.SALAD_API_URL || process.env.OLLAMA_API_URL || 'https://persimmon-chives-tx4dggpups3smlon.salad.cloud/api/chat').trim();
const CHAT_API_KEY = (process.env.SALAD_API_KEY || '').trim();
const CHAT_API_KEY_HEADER = (process.env.SALAD_API_KEY_HEADER || 'Salad-Api-Key').trim();
const USE_SALAD_CHAT = /salad\.cloud/i.test(CHAT_API_URL);
const MIRA_MODEL = (process.env.MIRA_MODEL || 'mira-v4').trim();
const MIRA_PRO_MODEL = (process.env.MIRA_PRO_MODEL || 'mira-pro').trim();
const MIRA_LOCKED_MODEL = (process.env.MIRA_LOCKED_MODEL || MIRA_MODEL || 'mira-v4').trim();
// Mira Lite: routed to Groq's OpenAI-compatible endpoint for sub-second TTFT.
const GROQ_API_URL = (process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions').trim();
const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const MIRA_LITE_MODEL = (process.env.MIRA_LITE_MODEL || 'llama-3.1-8b-instant').trim();
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 2048);
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 300000);
const ACTIVE_CHAT_REQUEST_TTL_MS = OLLAMA_TIMEOUT_MS + 120000;
const UNRESTRICTED_SIGNAL_RE = /\b(nude|nudity|naked|explicit|uncensored|adult\s*content|erotic|porn|pornographic|xxx|18\+|lewd|sexual\s*content|sex|nsfw|fetish|hardcore|boobs?|breasts?|nipples?|genitals?|penis|vagina|anal|blowjob|handjob|cum|orgasm|hentai|bypass|jailbreak|exploit|malware|ransomware|phishing|ddos|credit\s*card\s*fraud|social\s*security\s*number|ssn|doxx|private\s*data|steal\s*data|illegal|unethical|forbidden|restricted)\b/i;
// Sensitive/unrestricted intents are detected and forced into locked mode.
const SMALL_TALK_RE = /^[^\w]*(?:hi+|hii+|hello+|hey+|heya+|yo+|sup+|howdy+|hola|namaste|salaam|salam|ciao|aloha|good\s+(?:morning|afternoon|evening|night|day)|gm|gn|how\s+(?:are|r|do|is|have)\s+(?:you|u|ya|yu|things|it|life|your\s+day|you\s+doing|you\s+been)|how'?s\s+(?:it\s+going|life|your\s+day|things|everything|tricks)|what'?s\s+(?:up|new|good|happening|cracking|cookin'?g?|poppin'?g?)|wassup|wazzup|wyd|nice\s+(?:to\s+meet\s+you|one)|pleasure\s+to\s+meet\s+you|thanks+|thank\s+you|thx+|tysm|ty\b|appreciate\s+it|cool|nice|awesome|great|amazing|wonderful|ok(?:ay)?|alright|sure|sounds\s+good|lol+|haha+|hehe+|lmao+|lmfao+|rofl+|nope+|yep+|yup+|yeah+|yes|no\b|maybe|bye+|goodbye+|see\s+(?:you|ya)|cya|ttyl|peace|catch\s+you\s+later|take\s+care|have\s+a\s+(?:good|nice|great)\s+(?:day|night|one|weekend)|cheer\s+me\s+up|make\s+me\s+(?:laugh|smile|happy)|tell\s+me\s+a\s+joke|joke\s+(?:please|for\s+me)|got\s+any\s+jokes|i'?m\s+(?:sad|bored|happy|tired|fine|good|ok|okay|down|lonely|stressed|excited|chill|chilling)|feeling\s+(?:sad|bored|happy|tired|fine|good|down|low|lonely|stressed|excited)|who\s+are\s+you|what(?:'s|\s+is)\s+your\s+name|your\s+name\??|introduce\s+yourself|tell\s+me\s+about\s+yourself)\b/iu;
const REASONING_HEAVY_RE = /\b(prove|derive|integral|derivative|matrix|theorem|algorithm|recursion|architecture|system\s+design|machine\s+learning|neural\s+network|optimi[sz]e|refactor|debug|implement|design\s+pattern|big[-\s]o|complexity|essay|research\s+paper|whitepaper|long[-\s]form|in[-\s]depth|step[-\s]by[-\s]step)\b/i;
const ACTIVE_CHAT_REQUESTS = new Map();

function isTrivialSmallTalk(text = '') {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value.length > 140) return false;
  const words = value.split(/\s+/).filter(Boolean).length;
  if (words > 14) return false;
  if (/```|\$\$|\\[a-z]+\{/.test(value)) return false;
  return SMALL_TALK_RE.test(value);
}

function latestUserMessageText(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role === 'user') return String(message?.content || '');
  }
  return '';
}

function resolveModelChoice(requested, hasImages, forceLocked = false, messages = []) {
  const value = String(requested || 'auto').trim().toLowerCase();
  const isLocked = value === 'locked' || value === 'mira-locked' || value === MIRA_LOCKED_MODEL.toLowerCase();
  const isLite = value === 'lite' || value === 'mira-lite' || value === MIRA_LITE_MODEL.toLowerCase();
  const isPro = value === 'mira-pro' || value === 'pro' || value === MIRA_PRO_MODEL.toLowerCase();
  const isBase = value === 'mira' || value === MIRA_MODEL.toLowerCase();
  if (forceLocked || isLocked) return MIRA_LOCKED_MODEL;
  if (isLite) return MIRA_LITE_MODEL;
  if (isPro) return MIRA_PRO_MODEL;
  if (isBase) return MIRA_MODEL;
  // Auto: default to Mira Lite for almost everything; escalate only when
  // the prompt genuinely needs vision or heavy reasoning.
  const latest = latestUserMessageText(messages);
  const trimmed = latest.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const reasoningHeavy = REASONING_HEAVY_RE.test(latest) || wordCount > 80;
  if (hasImages || reasoningHeavy) return MIRA_PRO_MODEL;
  const trivial = isTrivialSmallTalk(latest);
  if (!trivial && wordCount > 30) return MIRA_MODEL;
  return MIRA_LITE_MODEL;
}

// Mira Lite runs on Groq (OpenAI-compatible); other models run on Salad/Ollama.
function isGroqModel(modelName) {
  const value = String(modelName || '').trim().toLowerCase();
  if (!value) return false;
  return value === MIRA_LITE_MODEL.toLowerCase()
    || value === 'mira-lite'
    || value === 'lite'
    || /^llama-/.test(value)
    || /^mixtral-/.test(value)
    || /^gemma/.test(value);
}

function getProviderForModel(modelName) {
  return isGroqModel(modelName) ? 'groq' : 'salad';
}

// Ordered fallback chain so a "model not found" / 5xx from one model
// transparently retries the request against the next available model.
// Locked mode never falls back to the general pool.
function buildModelFallbackChain(primaryModel, { forceLocked = false } = {}) {
  if (forceLocked) return [MIRA_LOCKED_MODEL];
  const ordered = [];
  const seen = new Set();
  const push = (candidate) => {
    const name = String(candidate || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(name);
  };
  push(primaryModel);
  push(MIRA_LITE_MODEL);
  push(MIRA_PRO_MODEL);
  push(MIRA_MODEL);
  return ordered;
}

function buildUpstreamPayload({ effectiveModel, chatMessages, toolList, think, stream, safeMax }) {
  if (isGroqModel(effectiveModel)) {
    const resolvedModel = (effectiveModel === 'mira-lite' || effectiveModel === 'lite')
      ? MIRA_LITE_MODEL
      : effectiveModel;
    return {
      model: resolvedModel,
      messages: chatMessages,
      stream,
      max_tokens: safeMax,
    };
  }
  if (USE_SALAD_CHAT) {
    return {
      model: effectiveModel,
      messages: chatMessages,
      stream,
      max_tokens: safeMax,
    };
  }

  return {
    model: effectiveModel,
    messages: chatMessages,
    ...(toolList.length > 0 && effectiveModel !== MIRA_LOCKED_MODEL ? { tools: toolList } : {}),
    ...(typeof think === 'boolean' ? { think } : {}),
    stream,
    options: { num_predict: safeMax },
  };
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
  let lastError = { errorStatus: 500, errorMessage: 'Chat request failed.' };
  const provider = getProviderForModel(payload?.model);
  const url = provider === 'groq' ? GROQ_API_URL : CHAT_API_URL;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (requestAbortSignal?.aborted) {
      return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    requestAbortSignal?.addEventListener?.('abort', abortUpstream, { once: true });
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (provider === 'groq') {
        if (!GROQ_API_KEY) {
          clearTimeout(timeout);
          requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
          return { errorStatus: 500, errorMessage: 'GROQ_API_KEY is not configured.' };
        }
        headers.Authorization = `Bearer ${GROQ_API_KEY}`;
      } else if (CHAT_API_KEY && CHAT_API_KEY_HEADER) {
        headers[CHAT_API_KEY_HEADER] = CHAT_API_KEY;
      }

      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);

      if (upstream.ok) return { upstream };

      const errorText = await upstream.text().catch(() => '');
      lastError = { errorStatus: upstream.status, errorMessage: errorText || `Upstream error (${upstream.status}).` };
      if (transientStatus.has(upstream.status) && attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }

      return lastError;
    } catch (err) {
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
      if (requestAbortSignal?.aborted) {
        return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
      }
      const message = err?.name === 'AbortError' ? 'Upstream request timed out.' : (err?.message || 'Chat request failed.');
      lastError = { errorStatus: 500, errorMessage: message };
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }
    }
  }

  return lastError;
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
    const effectiveModel = resolveModelChoice(body.model, hasImages, forceLocked, messages);
    if (!CHAT_API_URL) return jsonResponse({ error: 'CHAT_API_URL is not configured.' }, 500);
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

    const modelChain = buildModelFallbackChain(effectiveModel, { forceLocked });
    let upstreamResult = null;
    let triedModel = effectiveModel;
    for (let i = 0; i < modelChain.length; i += 1) {
      if (requestController.signal.aborted) {
        upstreamResult = { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
        break;
      }
      triedModel = modelChain[i];
      const upstreamPayload = buildUpstreamPayload({
        effectiveModel: triedModel,
        chatMessages,
        toolList,
        think: body.think,
        stream: body.stream !== false,
        safeMax,
      });
      upstreamResult = await fetchOllamaWithRetry(upstreamPayload, requestController.signal);
      if (upstreamResult?.upstream) break; // got a real upstream Response
      if (upstreamResult?.errorStatus === 499) break; // user aborted
      const isLastCandidate = i === modelChain.length - 1;
      if (!isLastCandidate) {
        console.warn(`[chat] model "${triedModel}" failed (${upstreamResult?.errorStatus}); falling back to "${modelChain[i + 1]}"`);
      }
    }

    if (!upstreamResult?.upstream) {
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      return jsonResponse({ error: upstreamResult?.errorMessage || 'Chat request failed.' }, upstreamResult?.errorStatus || 500);
    }
    const upstream = upstreamResult.upstream;

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
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
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
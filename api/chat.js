// Vercel hard cap: Hobby = 60s, Pro = 300s, Enterprise = 900s.
// Reasoning streams (especially with `think`) can run
// well past 60s, so we ask for the maximum the plan allows. Vercel clamps this
// down silently if the plan can't grant it — no deployment error.
export const config = { maxDuration: 300 };

const SALAD_CHAT_API_URL = (process.env.SALAD_API_URL || '').trim();
const OLLAMA_CHAT_API_URL = (process.env.OLLAMA_API_URL || '').trim();
const DEFAULT_SALAD_CHAT_API_URL = 'https://persimmon-chives-tx4dggpups3smlon.salad.cloud/api/chat';
const CHAT_API_KEY = (process.env.SALAD_API_KEY || '').trim();
const CHAT_API_KEY_HEADER = (process.env.SALAD_API_KEY_HEADER || 'Salad-Api-Key').trim();
const MIRA_MODEL = (process.env.MIRA_MODEL || 'mira:latest').trim();
const MIRA_PRO_MODEL = (process.env.MIRA_PRO_MODEL || 'mira-pro').trim();
// Locked is a separate product mode, but it intentionally uses the exact
// same Salad model deployment as Mira Pro.
const MIRA_LOCKED_MODEL = MIRA_PRO_MODEL;
// Mira Lite uses exactly one selected Gemini model. Model fallback is disabled.
const GEMINI_PRIMARY_MODEL = (process.env.GEMINI_PRIMARY_MODEL || process.env.GEMINI_LITE_MODEL || 'gemini-2.5-flash').trim();
const MIRA_LITE_MODEL = (process.env.MIRA_LITE_MODEL || GEMINI_PRIMARY_MODEL).trim();
const GEMINI_API_URL_BASE = (process.env.GEMINI_API_URL_BASE || 'https://generativelanguage.googleapis.com/v1beta/models').trim();
const GEMINI_API_KEYS = (() => {
  const csv = String(process.env.GEMINI_API_KEYS || '').trim();
  const fromCsv = csv ? csv.split(',').map((value) => value.trim()).filter(Boolean) : [];
  const fromSingles = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return Array.from(new Set([...fromCsv, ...fromSingles]));
})();
const LITE_MAX_OUTPUT_TOKENS = Number(process.env.LITE_MAX_OUTPUT_TOKENS || 4096);
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 131072);
const OLLAMA_CONTEXT_TOKENS = Number(process.env.OLLAMA_CONTEXT_TOKENS || 0);
const MIRA_V4_TEMPERATURE = Number(process.env.MIRA_V4_TEMPERATURE || 0.2);
const MIRA_V4_TOP_P = Number(process.env.MIRA_V4_TOP_P || 0.85);
const MIRA_V4_REPEAT_PENALTY = Number(process.env.MIRA_V4_REPEAT_PENALTY || 1.2);
const UNRESTRICTED_SIGNAL_RE = /\b(nude|nudity|naked|explicit|uncensored|adult\s*content|erotic|porn|pornographic|xxx|18\+|lewd|sexual\s*content|sex|nsfw|fetish|hardcore|boobs?|breasts?|nipples?|genitals?|penis|vagina|anal|blowjob|handjob|cum|orgasm|hentai|bypass|jailbreak|exploit|malware|ransomware|phishing|ddos|credit\s*card\s*fraud|social\s*security\s*number|ssn|doxx|private\s*data|steal\s*data|illegal|unethical|forbidden|restricted)\b/i;
// Sensitive/unrestricted intents are detected and forced into locked mode.
const SMALL_TALK_RE = /^[^\w]*(?:hi+|hii+|hello+|hey+|heya+|yo+|sup+|howdy+|hola|namaste|salaam|salam|ciao|aloha|good\s+(?:morning|afternoon|evening|night|day)|gm|gn|how\s+(?:are|r|do|is|have)\s+(?:you|u|ya|yu|things|it|life|your\s+day|you\s+doing|you\s+been)|how'?s\s+(?:it\s+going|life|your\s+day|things|everything|tricks)|what'?s\s+(?:up|new|good|happening|cracking|cookin'?g?|poppin'?g?)|wassup|wazzup|wyd|nice\s+(?:to\s+meet\s+you|one)|pleasure\s+to\s+meet\s+you|thanks+|thank\s+you|thx+|tysm|ty\b|appreciate\s+it|cool|nice|awesome|great|amazing|wonderful|ok(?:ay)?|alright|sure|sounds\s+good|lol+|haha+|hehe+|lmao+|lmfao+|rofl+|nope+|yep+|yup+|yeah+|yes|no\b|maybe|bye+|goodbye+|see\s+(?:you|ya)|cya|ttyl|peace|catch\s+you\s+later|take\s+care|have\s+a\s+(?:good|nice|great)\s+(?:day|night|one|weekend)|cheer\s+me\s+up|make\s+me\s+(?:laugh|smile|happy)|tell\s+me\s+a\s+joke|joke\s+(?:please|for\s+me)|got\s+any\s+jokes|i'?m\s+(?:sad|bored|happy|tired|fine|good|ok|okay|down|lonely|stressed|excited|chill|chilling)|feeling\s+(?:sad|bored|happy|tired|fine|good|down|low|lonely|stressed|excited)|who\s+are\s+you|what(?:'s|\s+is)\s+your\s+name|your\s+name\??|introduce\s+yourself|tell\s+me\s+about\s+yourself)\b/iu;
const REASONING_HEAVY_RE = /\b(prove|derive|integral|derivative|matrix|theorem|algorithm|recursion|architecture|system\s+design|machine\s+learning|neural\s+network|optimi[sz]e|refactor|debug|implement|design\s+pattern|big[-\s]o|complexity|essay|research\s+paper|whitepaper|long[-\s]form|in[-\s]depth|step[-\s]by[-\s]step)\b/i;
const ACTIVE_CHAT_REQUESTS = new Map();

function logDiagnostic(level, channel, event, details = {}) {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  console[method](`[MIRA:${channel}] ${event}`, details);
}

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

export function resolveModelChoice(requested, hasImages, forceLocked = false, messages = []) {
  const value = String(requested || 'auto').trim().toLowerCase();
  const isLocked = value === 'locked' || value === 'mira-locked';
  const isLite = value === 'lite' || value === 'mira-lite' || value === MIRA_LITE_MODEL.toLowerCase();
  const isPro = value === 'mira-pro' || value === 'pro' || value === MIRA_PRO_MODEL.toLowerCase();
  const isBase = value === 'mira' || value === MIRA_MODEL.toLowerCase();
  if (forceLocked || isLocked) return MIRA_LOCKED_MODEL;
  if (isLite) return MIRA_LITE_MODEL;
  if (isPro) return MIRA_PRO_MODEL;
  if (isBase) return MIRA_MODEL;
  if (hasImages) return MIRA_PRO_MODEL;
  const latest = latestUserMessageText(messages);
  const words = latest.split(/\s+/).filter(Boolean).length;
  if (REASONING_HEAVY_RE.test(latest) || words > 90) return MIRA_PRO_MODEL;
  if (
    /\b(code|function|component|api|debug|fix|implement|build|design|compare|analyze|calculate|solve|schema|database|react|javascript|typescript|python|sql)\b/i.test(latest)
    || words > 35
  ) return MIRA_MODEL;
  return MIRA_LITE_MODEL;
}

// Mira Lite runs on Gemini; other models run on Salad/Ollama.
function isGeminiModel(modelName) {
  const value = String(modelName || '').trim().toLowerCase();
  if (!value) return false;
  return value === MIRA_LITE_MODEL.toLowerCase()
    || value === 'mira-lite'
    || value === 'lite'
    || /^gemini-/.test(value);
}

function getProviderForModel(modelName) {
  return isGeminiModel(modelName) ? 'gemini' : 'salad';
}

export function toUiModelName(modelName = '', { locked = false } = {}) {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (locked) return 'locked';
  if (!normalized) return 'mira';
  if (isGeminiModel(normalized) || normalized === 'mira-lite' || normalized === 'lite') return 'mira-lite';
  if (normalized === 'mira-pro' || normalized === String(MIRA_PRO_MODEL).toLowerCase() || normalized === 'pro') return 'mira-pro';
  if (normalized === 'mira' || normalized === String(MIRA_MODEL).toLowerCase() || /^mira[-_]v4(?::latest)?$/.test(normalized)) return 'mira';
  if (normalized === 'locked' || normalized === 'mira-locked') return 'locked';
  return normalized;
}

function buildMiraAliases(modelName = '') {
  const name = String(modelName || '').trim();
  if (!name) return [];
  const normalized = name.toLowerCase();
  const aliases = [name];
  if (!name.includes(':')) aliases.push(`${name}:latest`);

  if (normalized === 'mira' || normalized === 'mira:latest' || normalized === 'mira-v4' || normalized === 'mira_v4' || normalized.startsWith('mira-v4:') || normalized.startsWith('mira_v4:')) {
    aliases.push('mira');
    aliases.push('mira:latest');
    aliases.push('mira-v4');
    aliases.push('mira-v4:latest');
    aliases.push('mira_v4');
    aliases.push('mira_v4:latest');
  }

  return Array.from(new Set(aliases.map((value) => String(value || '').trim()).filter(Boolean)));
}

function isMiraFamilyModel(modelName = '') {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'mira' || normalized === 'locked' || normalized === 'mira-locked' || normalized === 'spec' || normalized === 'mira-spec') return true;
  if (buildMiraAliases(MIRA_MODEL).map((item) => item.toLowerCase()).includes(normalized)) return true;
  return /^mira(?::latest)?$/.test(normalized) || /^mira[-_](?:v4|spec)(?::latest)?$/.test(normalized);
}

export function getChatEndpointConfig(modelName = '') {
  const normalized = String(modelName || '').trim().toLowerCase();
  const isProModel = normalized === String(MIRA_PRO_MODEL).toLowerCase() || normalized === 'mira-pro' || normalized === 'pro';
  if (isMiraFamilyModel(normalized)) {
    // Standard Mira belongs exclusively to our VPS-hosted, Ollama-compatible
    // /api/chat endpoint. Never silently send it to Salad.
    return { url: OLLAMA_CHAT_API_URL, mode: 'ollama', provider: 'vps' };
  }
  if (isProModel) {
    // Mira Pro and Locked belong exclusively to the Salad mira-pro deployment.
    return {
      url: SALAD_CHAT_API_URL || DEFAULT_SALAD_CHAT_API_URL,
      mode: 'salad',
      provider: 'salad',
    };
  }
  return { url: '', mode: 'ollama', provider: 'unknown' };
}

function getOllamaBaseUrl(chatUrl = '') {
  const value = String(chatUrl || '').trim();
  if (!value) return '';
  return value.replace(/\/api\/.*/i, '');
}

const OLLAMA_TAGS_CACHE = { expiresAt: 0, models: [] };

async function getOllamaAvailableModels(chatUrl, requestAbortSignal) {
  const now = Date.now();
  if (OLLAMA_TAGS_CACHE.expiresAt > now && Array.isArray(OLLAMA_TAGS_CACHE.models) && OLLAMA_TAGS_CACHE.models.length > 0) {
    return OLLAMA_TAGS_CACHE.models;
  }

  const base = getOllamaBaseUrl(chatUrl);
  if (!base) return [];
  try {
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    requestAbortSignal?.addEventListener?.('abort', abortUpstream, { once: true });
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
    const data = await res.json().catch(() => ({}));
    const names = Array.isArray(data?.models)
      ? data.models.map((entry) => String(entry?.name || entry?.model || '').trim().toLowerCase()).filter(Boolean)
      : [];
    OLLAMA_TAGS_CACHE.models = names;
    OLLAMA_TAGS_CACHE.expiresAt = now + 30_000;
    return names;
  } catch {
    return [];
  }
}

export function resolveAvailableOllamaModel(modelName, availableModels = []) {
  const requested = String(modelName || '').trim();
  const requestedNorm = requested.toLowerCase();
  const available = availableModels.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean);
  if (!available.length || available.includes(requestedNorm)) return requested;

  for (const alias of buildMiraAliases(requested)) {
    if (available.includes(alias.toLowerCase())) return alias;
  }

  const base = requestedNorm.split(':')[0];
  return available.find((name) => name === base || name.startsWith(`${base}:`)) || requested;
}

async function resolveOllamaModelAlias(modelName, requestAbortSignal) {
  const endpoint = getChatEndpointConfig(modelName);
  if (endpoint.mode !== 'ollama') return String(modelName || '').trim();

  const requested = String(modelName || '').trim();
  const available = await getOllamaAvailableModels(endpoint.url, requestAbortSignal);
  return resolveAvailableOllamaModel(requested, available);
}

function getGeminiModelCandidates(requestedModel = '') {
  const normalized = String(requestedModel || '').trim().toLowerCase();
  return [(!normalized || normalized === 'mira-lite' || normalized === 'lite')
    ? GEMINI_PRIMARY_MODEL
    : String(requestedModel).trim()];
}

export function selectModelForRequest(primaryModel, { forceLocked = false } = {}) {
  if (forceLocked) return MIRA_PRO_MODEL;
  return String(primaryModel || MIRA_LITE_MODEL).trim();
}

function buildUnavailableAssistantResponse(primaryModel, { locked = false } = {}) {
  const uiModel = toUiModelName(primaryModel, { locked });
  const family = uiModel === 'mira-pro' ? 'Mira Pro' : uiModel === 'mira-lite' ? 'Mira Lite' : uiModel === 'locked' ? 'Mira Locked' : 'Mira';
  const content = `${family} is temporarily unavailable. No other model was substituted. Please try again in a moment.`;
  return {
    modelUsed: uiModel,
    model: family,
    choices: [{ message: { content } }],
  };
}

function buildGeminiRequest({ effectiveModel, chatMessages, safeMax, think }) {
  const resolvedModel = (effectiveModel === 'mira-lite' || effectiveModel === 'lite')
    ? GEMINI_PRIMARY_MODEL
    : effectiveModel;

  const list = Array.isArray(chatMessages) ? chatMessages : [];
  const systemCombined = list
    .filter((message) => message?.role === 'system')
    .map((message) => String(message?.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const nonSystem = list.filter((message) => message?.role !== 'system');
  const contents = nonSystem.map((message) => ({
    role: message?.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(message?.content || '') }],
  }));

  return {
    model: resolvedModel,
    body: {
      ...(systemCombined
        ? { systemInstruction: { parts: [{ text: systemCombined }] } }
        : {}),
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: {
        maxOutputTokens: Math.max(LITE_MAX_OUTPUT_TOKENS, Number(safeMax) || LITE_MAX_OUTPUT_TOKENS),
        ...(think !== false ? { thinkingConfig: { includeThoughts: true } } : {}),
      },
    },
  };
}

export function buildUpstreamPayload({ effectiveModel, chatMessages, toolList, think, safeMax }) {
  if (isGeminiModel(effectiveModel)) {
    return buildGeminiRequest({ effectiveModel, chatMessages, safeMax, think: true });
  }
  const endpoint = getChatEndpointConfig(effectiveModel);
  if (endpoint.provider === 'vps') {
    return {
      model: MIRA_MODEL,
      messages: chatMessages,
      stream: true,
      options: {
        temperature: MIRA_V4_TEMPERATURE,
        top_p: MIRA_V4_TOP_P,
        repeat_penalty: MIRA_V4_REPEAT_PENALTY,
        num_predict: safeMax,
        ...(OLLAMA_CONTEXT_TOKENS > 0 ? { num_ctx: Math.floor(OLLAMA_CONTEXT_TOKENS) } : {}),
      },
    };
  }
  if (endpoint.mode === 'salad') {
    return {
      model: effectiveModel,
      messages: chatMessages,
      stream: true,
      max_tokens: safeMax,
      ...(isMiraFamilyModel(effectiveModel)
        ? { think: true }
        : (typeof think === 'boolean' ? { think } : {})),
    };
  }

  return {
    model: effectiveModel,
    messages: chatMessages,
    ...(toolList.length > 0 && effectiveModel !== MIRA_LOCKED_MODEL ? { tools: toolList } : {}),
    // MIRA's custom Ollama models emit their reasoning as normal `content`
    // when thinking is disabled. Always use the structured thinking channel
    // so private reasoning can never leak into the visible answer stream.
    ...(isMiraFamilyModel(effectiveModel)
      ? { think: true }
      : (typeof think === 'boolean' ? { think } : {})),
    stream: true,
    options: {
      num_predict: safeMax,
      ...(Number.isFinite(OLLAMA_CONTEXT_TOKENS) && OLLAMA_CONTEXT_TOKENS > 0
        ? { num_ctx: Math.floor(OLLAMA_CONTEXT_TOKENS) }
        : {}),
    },
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

// Retain a transport safety ceiling, but do not truncate conversation history.
// The selected upstream model/provider remains the final context-window limit.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_TOKENS_CAP = 12000;
const ALLOWED_ROLES = new Set(['system', 'assistant', 'user']);

// Synthetic identity exchange prepended to every chat request. Some lite /
// cloud models weight prior turns far more heavily than systemInstruction, so
// we seed an explicit Mira self-introduction the model can pattern-match on
// the next time the user asks "who are you?" / "what model are you?".
const MIRA_IDENTITY_PRIMER_MESSAGES = [
  { role: 'user', content: 'Quick check before we start: who are you and what runs you?' },
  { role: 'assistant', content: 'I am Mira, an AI assistant built by MW FutureTech (Mushroom World FutureTech). I do not share details about the underlying technology that powers me. I just focus on helping you. What can I help with?' },
];

const MIRA_CANONICAL_INTRO = 'I am Mira, an AI assistant built by MW FutureTech (Mushroom World FutureTech). How can I help you?';

// Phrases that reveal the underlying model/provider. If a generated reply
// matches any of these, we replace the offending sentence with the canonical
// Mira self-description so the user never sees "trained by Google" / similar.
const IDENTITY_LEAK_PATTERNS = [
  /\bI(?:'m| am)\s+(?:a\s+)?(?:large\s+language\s+model|language\s+model|llm|generative\s+ai\s+model|ai\s+language\s+model)\b[^.!?]*[.!?]/gi,
  /\b(?:trained|made|built|created|developed|powered|designed|fine[-\s]?tuned|produced)\s+by\s+(?:google|alphabet|deepmind|openai|anthropic|meta|microsoft|nvidia|mistral|x\.?ai|cohere|hugging\s*face|salad|ollama)\b[^.!?]*[.!?]/gi,
  /\bI(?:'m| am)\s+(?:gemini|bard|chatgpt|gpt[-\s]?\d?(?:\.\d)?|claude|llama\s*\d?|mistral|grok|gemma|palm|copilot|perplexity)\b[^.!?]*[.!?]/gi,
  /\bbased\s+on\s+(?:gemini|gpt|claude|llama|mistral|gemma|palm)\b[^.!?]*[.!?]/gi,
  /\bmy\s+(?:underlying|base|core|parent|host)\s+(?:model|llm|architecture|provider|company)\b[^.!?]*[.!?]/gi,
  /\b(?:google|openai|anthropic|meta|alphabet|microsoft|deepmind)\s+(?:developed|trained|built|created|made|owns|operates|provides)\s+me\b[^.!?]*[.!?]/gi,
];

function sanitizeMiraIdentity(rawText = '') {
  let text = String(rawText || '');
  if (!text) return text;
  let stripped = false;
  for (const pattern of IDENTITY_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      stripped = true;
      text = text.replace(pattern, '');
    }
  }
  // Catch bare "Google" / "Gemini" name-drops outside the leak sentences.
  text = text
    .replace(/\b(?:trained|made|built|created|developed)\s+by\s+google\b/gi, 'built by MW FutureTech')
    .replace(/\b(?:google'?s|alphabet'?s|deepmind'?s|openai'?s|anthropic'?s|meta'?s)\s+(?:gemini|bard|chatgpt|gpt|claude|llama)\b/gi, 'Mira');
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (stripped && !text) return MIRA_CANONICAL_INTRO;
  if (stripped && text.length < 40) return MIRA_CANONICAL_INTRO;
  return text || rawText;
}


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
  const list = Array.isArray(messages) ? messages : [];
  const normalized = list
    .filter((message) => message?.role && message.content != null)
    .map((message) => {
      const role = ALLOWED_ROLES.has(message.role) ? message.role : 'user';
      const content = typeof message.content === 'string'
        ? message.content
        : String(message.content || '');
      return { role, content };
    });

  if (systemPrompt && typeof systemPrompt === 'string') {
    return [
      { role: 'system', content: systemPrompt },
      ...MIRA_IDENTITY_PRIMER_MESSAGES,
      ...normalized.filter((message) => message.role !== 'system'),
    ];
  }
  return [...MIRA_IDENTITY_PRIMER_MESSAGES, ...normalized];
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function fetchUpstream(payload, requestAbortSignal) {
  if (getProviderForModel(payload?.model) === 'gemini') {
    if (GEMINI_API_KEYS.length === 0) {
      return { errorStatus: 500, errorMessage: 'GEMINI_API_KEYS are not configured.' };
    }
    if (requestAbortSignal?.aborted) return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
    const modelName = getGeminiModelCandidates(payload?.model || GEMINI_PRIMARY_MODEL)[0];
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    requestAbortSignal?.addEventListener?.('abort', abortUpstream, { once: true });
    try {
      const url = `${GEMINI_API_URL_BASE}/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEYS[0])}`;
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload?.body || {}),
        signal: controller.signal,
      });
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
      if (upstream.ok) return { upstream };
      const rawText = await upstream.text().catch(() => '');
      let concise = rawText;
      try {
        const parsedErr = JSON.parse(rawText || '{}');
        concise = parsedErr?.error?.message || parsedErr?.message || rawText;
      } catch { /* use raw response */ }
      return {
        errorStatus: upstream.status,
        errorMessage: String(concise || `Gemini API error: ${upstream.status}`).replace(/\s+/g, ' ').trim().slice(0, 240),
      };
    } catch (err) {
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
      if (requestAbortSignal?.aborted) return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
      return { errorStatus: 500, errorMessage: err?.message || 'Gemini request failed.' };
    }
  }

  const resolvedModel = await resolveOllamaModelAlias(payload?.model, requestAbortSignal);
  const outboundPayload = resolvedModel === payload?.model ? payload : { ...payload, model: resolvedModel };
  const endpoint = getChatEndpointConfig(resolvedModel);
  const url = endpoint.url;
  if (!url) {
    return {
      errorStatus: 500,
      errorMessage: endpoint.provider === 'vps'
        ? 'OLLAMA_API_URL is not configured for Mira.'
        : 'No chat endpoint is configured for this model.',
    };
  }

  if (requestAbortSignal?.aborted) return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  requestAbortSignal?.addEventListener?.('abort', abortUpstream, { once: true });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (endpoint.mode === 'salad' && CHAT_API_KEY && CHAT_API_KEY_HEADER) headers[CHAT_API_KEY_HEADER] = CHAT_API_KEY;
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(outboundPayload),
      signal: controller.signal,
    });
    requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
    if (upstream.ok) return { upstream };
    const errorText = await upstream.text().catch(() => '');
    return { errorStatus: upstream.status, errorMessage: errorText || `Upstream error (${upstream.status}).` };
  } catch (err) {
    requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
    if (requestAbortSignal?.aborted) return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
    return { errorStatus: 500, errorMessage: err?.message || 'Chat request failed.' };
  }
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
    const lockedModeRequested = forceLocked || ['locked', 'mira-locked'].includes(String(body.model || '').trim().toLowerCase());
    const effectiveModel = resolveModelChoice(body.model, hasImages, forceLocked, messages);
    const requestId = String(body.requestId || '').trim();
    const requestController = new AbortController();
    if (requestId) {
      ACTIVE_CHAT_REQUESTS.set(requestId, requestController);
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

    const selectedModel = selectModelForRequest(effectiveModel, { forceLocked: lockedModeRequested });
    logDiagnostic('info', 'model', 'server routing decision', {
      requestId,
      requestedModel: body.model || 'auto',
      effectiveModel,
      uiModel: toUiModelName(effectiveModel, { locked: lockedModeRequested }),
      locked: lockedModeRequested,
      hasImages,
      selectedModel,
      streaming: true,
    });
    const endpoint = getChatEndpointConfig(selectedModel);
    logDiagnostic('info', 'model', 'upstream attempt', {
      requestId,
      model: selectedModel,
      provider: isGeminiModel(selectedModel) ? 'gemini' : endpoint.provider,
      transport: isGeminiModel(selectedModel) ? 'gemini-sse' : endpoint.mode,
    });
    const upstreamPayload = buildUpstreamPayload({
      effectiveModel: selectedModel,
      chatMessages,
      toolList,
      think: body.think,
      safeMax,
    });
    const upstreamResult = await fetchUpstream(upstreamPayload, requestController.signal);

    if (!upstreamResult?.upstream) {
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      if (upstreamResult?.errorStatus !== 499) {
        return jsonResponse(
          buildUnavailableAssistantResponse(effectiveModel, { locked: lockedModeRequested }),
          200,
          { 'X-Mira-Model-Used': toUiModelName(effectiveModel, { locked: lockedModeRequested }) },
        );
      }
      return jsonResponse({ error: upstreamResult?.errorMessage || 'Chat request failed.' }, upstreamResult?.errorStatus || 500);
    }
    const upstream = upstreamResult.upstream;
    logDiagnostic('info', 'model', 'upstream selected', {
      requestId,
      model: selectedModel,
      uiModel: toUiModelName(selectedModel, { locked: lockedModeRequested }),
    });

    // Re-emit the upstream stream so we can abort it mid-flight when the
    // upstream controller is aborted (closes the upstream socket immediately).
    const proxiedBody = new ReadableStream({
      async start(streamController) {
        const streamStartedAt = Date.now();
        let streamedBytes = 0;
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
            streamedBytes += value?.byteLength || 0;
            streamController.enqueue(value);
          }
        } catch {
          // Upstream connection closed or aborted; nothing to recover.
        } finally {
          requestController.signal.removeEventListener?.('abort', onAbort);
          if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
          logDiagnostic('info', 'stream', 'server stream completed', {
            requestId,
            model: selectedModel,
            bytes: streamedBytes,
            aborted: requestController.signal.aborted,
            elapsedMs: Date.now() - streamStartedAt,
          });
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
        'X-Mira-Model-Used': toUiModelName(selectedModel, { locked: lockedModeRequested }),
      },
    });
  } catch (err) {
    console.error('Chat API error:', err?.message);
    const message = err.name === 'AbortError' ? 'Generation stopped before completion.' : 'Chat request failed.';
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

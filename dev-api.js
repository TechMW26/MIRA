import http from 'http';
import fs from 'fs';
import path from 'path';

// Lightweight .env loader (no extra deps). Loads KEY=VALUE pairs from ./.env
// into process.env if they aren't already defined.
(function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (e) {
    console.warn('dev-api: failed to load .env:', e.message);
  }
})();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const GENERATED_IMAGE_UPSTREAM_TIMEOUT_MS = 18000;
const GENERATED_IMAGE_RETRY_ATTEMPTS = 3;
const GENERATED_IMAGE_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const GENERATED_IMAGE_ALT_SEARCH_TIMEOUT_MS = 12000;
const GENERATED_IMAGE_SEARCH_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'to', 'from', 'by', 'into', 'split-shot', 'photograph', 'photo', 'image', 'stunning', 'majestic', 'crystal-clear']);
const ANCHOR_STOP = new Set(['the','a','an','of','to','for','in','on','with','and','or','but','is','are','was','were','what','how','why','when','where','this','that','it','its','they','them','about','more','can','you','tell','please','show','give','find','search','get','some','image','images','photo','picture','video','videos','media','device','product','object','thing','system','technology']);

function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/["'`“”‘’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value = '') {
  return normalizeSearchText(value).split(' ').filter((word) => word.length >= 3 && !ANCHOR_STOP.has(word));
}

function extractAnchorPhrase(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const quoted = text.match(/["“]([^"”]{2,80})["”]/)?.[1]?.trim();
  if (quoted) return quoted;
  const title = text.match(/\b[A-Z][A-Za-z0-9&+.-]*(?:\s+[A-Z][A-Za-z0-9&+.-]*){1,5}\b/)?.[0]?.trim();
  if (title) return title.replace(/^(?:the|a|an)\s+/i, '');
  return text.split(/[,;|:()]/)[0].trim().split(/\s+/).slice(0, 4).join(' ');
}

function buildAnchorScope(anchor = '') {
  const phrase = extractAnchorPhrase(anchor);
  const terms = Array.from(new Set(searchTokens(phrase || anchor))).slice(0, 6);
  return { phrase, phraseNorm: normalizeSearchText(phrase), terms };
}

function anchorThreshold(scope) {
  return scope?.terms?.length >= 2 ? 2 : 1;
}

function scoreAgainstAnchor(text = '', scope) {
  if (!scope?.terms?.length) return 0;
  const haystack = normalizeSearchText(text);
  if (!haystack) return 0;
  let score = scope.phraseNorm && haystack.includes(scope.phraseNorm) ? 10 : 0;
  for (const term of scope.terms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function filterByAnchor(items, scope, getText, strict = false) {
  if (!Array.isArray(items) || !items.length || !scope?.terms?.length) return items || [];
  const scored = items.map((item) => ({ item, score: scoreAgainstAnchor(getText(item), scope) }));
  const exact = scored.filter((entry) => scope.phraseNorm && entry.score >= 10);
  if (exact.length) return exact.map((entry) => entry.item);
  if (!strict) return items;
  return scored.filter((entry) => entry.score >= anchorThreshold(scope)).map((entry) => entry.item);
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanImageText(value = '') {
  return decodeHtmlEntities(value)
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBingImageMetadata(html = '', query = '', anchorScope = null, strictAnchor = false) {
  const items = [];
  const seen = new Set();
  const tags = html.match(/<a\b(?=[^>]*\biusc\b)[^>]*>/gi) || [];
  for (const tag of tags) {
    const attr = tag.match(/\bm=(['"])(.*?)\1/i)?.[2];
    if (!attr) continue;
    let meta;
    try {
      meta = JSON.parse(decodeHtmlEntities(attr));
    } catch {
      continue;
    }
    const original = meta.murl || '';
    const thumbnail = meta.turl || original;
    const source = meta.purl || `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
    const title = cleanImageText(meta.t || meta.desc || '');
    const desc = cleanImageText(meta.desc || '');
    const key = original || thumbnail;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      url: original || thumbnail,
      thumbnail,
      title,
      source,
      _score: scoreAgainstAnchor(`${title} ${desc} ${source} ${original}`, anchorScope),
    });
  }

  const filtered = strictAnchor
    ? filterByAnchor(items, anchorScope, (im) => `${im.title || ''} ${im.source || ''} ${im.url || ''}`, true)
    : items;

  return filtered.map(({ _score, ...item }) => item);
}

function imageQueryVariants(query = '', anchorScope = null) {
  const unquoted = String(query || '').replace(/["“”]/g, '').trim();
  const phrase = anchorScope?.phrase || '';
  return Array.from(new Set([
    unquoted,
    query,
    phrase,
    phrase ? `${phrase} photo` : '',
    phrase ? `${phrase} images` : '',
  ].filter(Boolean)));
}

function buildResultAnchoredImageQuery(results = [], anchorScope = null, fallback = '') {
  if (!anchorScope?.terms?.length) return fallback;
  const hit = (results || []).find((result) => scoreAgainstAnchor(`${result.title || ''} ${result.snippet || ''}`, anchorScope) >= 10)
    || (results || []).find((result) => scoreAgainstAnchor(`${result.title || ''} ${result.snippet || ''}`, anchorScope) >= anchorThreshold(anchorScope));
  if (!hit?.title) return fallback;
  const cleaned = cleanImageText(hit.title)
    .replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/g, '')
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .slice(0, 10)
    .join(' ')
    .trim();
  return cleaned || fallback;
}

// === Chat provider configuration ===
const CHAT_API_URL = (process.env.SALAD_API_URL || process.env.OLLAMA_API_URL || 'https://persimmon-chives-tx4dggpups3smlon.salad.cloud/api/chat').trim();
const CHAT_API_KEY = (process.env.SALAD_API_KEY || '').trim();
const CHAT_API_KEY_HEADER = (process.env.SALAD_API_KEY_HEADER || 'Salad-Api-Key').trim();
const USE_SALAD_CHAT = /salad\.cloud/i.test(CHAT_API_URL);
const MIRA_MODEL = (process.env.MIRA_MODEL || 'mira-v4').trim();
const MIRA_PRO_MODEL = (process.env.MIRA_PRO_MODEL || 'mira-pro').trim();
const MIRA_LOCKED_MODEL = (process.env.MIRA_LOCKED_MODEL || MIRA_MODEL || 'mira-v4').trim();
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
  const isPro = value === 'auto' || value === 'mira-pro' || value === 'pro' || value === MIRA_PRO_MODEL.toLowerCase();
  if (forceLocked || isLocked) return MIRA_LOCKED_MODEL;
  if (value === 'auto' || !value) {
    const latest = latestUserMessageText(messages);
    const wordCount = latest.trim() ? latest.trim().split(/\s+/).filter(Boolean).length : 0;
    const reasoningHeavy = REASONING_HEAVY_RE.test(latest) || (!isTrivialSmallTalk(latest) && wordCount > 80);
    return hasImages || reasoningHeavy ? MIRA_PRO_MODEL : MIRA_MODEL;
  }
  if (isPro) return MIRA_PRO_MODEL;
  return MIRA_MODEL;
}

function buildUpstreamPayload({ effectiveModel, chatMessages, toolList, think, stream, safeMax }) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOllamaWithRetry(payload, requestAbortSignal) {
  const transientStatus = new Set([408, 429, 500, 502, 503, 504]);
  const maxAttempts = 2;
  let lastStatus = 500;
  let lastMessage = 'Chat request failed.';

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
      if (CHAT_API_KEY && CHAT_API_KEY_HEADER) headers[CHAT_API_KEY_HEADER] = CHAT_API_KEY;

      const upstream = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);

      if (upstream.ok) return upstream;

      const errorText = await upstream.text().catch(() => '');
      lastStatus = upstream.status;
      lastMessage = errorText || `Upstream API error: ${upstream.status}`;
      if (transientStatus.has(upstream.status) && attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }
      return { errorStatus: lastStatus, errorMessage: lastMessage };
    } catch (err) {
      clearTimeout(timeout);
      requestAbortSignal?.removeEventListener?.('abort', abortUpstream);
      if (requestAbortSignal?.aborted) {
        return { errorStatus: 499, errorMessage: 'Generation stopped by user.' };
      }
      lastStatus = 500;
      lastMessage = err.name === 'AbortError' ? `Upstream API timeout after ${OLLAMA_TIMEOUT_MS}ms` : (err.message || 'Chat request failed.');
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }
      return { errorStatus: lastStatus, errorMessage: lastMessage };
    }
  }

  return { errorStatus: lastStatus, errorMessage: lastMessage };
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

function normalizeMessages(messages = [], systemPrompt) {
  const normalized = messages
    .filter((message) => message?.role && message.content != null)
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: typeof message.content === 'string' ? message.content : String(message.content || ''),
    }));
  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...normalized.filter((message) => message.role !== 'system')];
  }
  return normalized;
}

// Ollama vision (llama3.2-vision) requires images attached to the user
// message as `images: [base64, ...]` (raw base64 only).
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

async function writeUpstreamBody(upstream, res, abortSignal) {
  const reader = upstream.body?.getReader();
  if (!reader) {
    res.end(await upstream.text());
    return;
  }

  const onAbort = () => {
    try { reader.cancel(); } catch { /* ignore */ }
    try { res.end(); } catch { /* ignore */ }
  };
  if (abortSignal?.aborted) {
    onAbort();
    return;
  }
  abortSignal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    while (true) {
      if (abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (abortSignal?.aborted) break;
      const ok = res.write(Buffer.from(value));
      if (!ok) await new Promise((resolve) => res.once('drain', resolve));
    }
  } catch {
    // Upstream socket closed mid-stream (typically because we aborted it).
  } finally {
    abortSignal?.removeEventListener?.('abort', onAbort);
    try { res.end(); } catch { /* ignore */ }
  }
}

async function handleChat(body, res, req) {
  const payload = JSON.parse(body || '{}');
  if (payload?.action === 'cancel') {
    const requestId = String(payload?.requestId || '').trim();
    if (!requestId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'requestId is required.' }));
      return;
    }

    const controller = ACTIVE_CHAT_REQUESTS.get(requestId);
    if (controller) {
      controller.abort();
      ACTIVE_CHAT_REQUESTS.delete(requestId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stopped: true }));
    return;
  }

  const imageList = Array.isArray(payload.images) ? payload.images.slice(0, 6) : [];
  const toolList = Array.isArray(payload.tools) ? payload.tools.slice(0, 32) : [];
  const messages = normalizeMessages(payload.messages, payload.systemPrompt);
  if (messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'At least one chat message is required.' }));
    return;
  }

  const safeMax = Math.max(1, Math.min(Number(payload.max_tokens) || OLLAMA_MAX_TOKENS, 12000));
  const promptImages = extractLastUserImages(messages, imageList);
  const hasImages = promptImages.length > 0;
  const forceLocked = hasUnrestrictedSignals(messages);
  const effectiveModel = resolveModelChoice(payload.model, hasImages, forceLocked, messages);
  const requestId = String(payload.requestId || '').trim();
  const requestController = new AbortController();
  if (requestId) {
    ACTIVE_CHAT_REQUESTS.set(requestId, requestController);
    setTimeout(() => {
      ACTIVE_CHAT_REQUESTS.delete(requestId);
    }, ACTIVE_CHAT_REQUEST_TTL_MS);
  }

  // When the client disconnects mid-stream (Stop pressed, tab closed) the
  // response socket closes before res.end() runs — that's our signal to abort
  // the upstream Ollama fetch. We must NOT listen on req('close'): in Node 16+
  // IncomingMessage auto-destroys right after 'end', emitting 'close' as part
  // of normal request completion which would abort before generation begins.
  const onResponseClose = () => {
    if (res.writableEnded) return;
    if (!requestController.signal.aborted) requestController.abort();
    if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
  };
  res?.once?.('close', onResponseClose);

  if (!CHAT_API_URL) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'CHAT_API_URL is not configured.' }));
    return;
  }

  const chatMessages = hasImages
    ? attachImagesToLastUser(messages, promptImages)
    : messages;

  try {
    const upstreamPayload = buildUpstreamPayload({
      effectiveModel,
      chatMessages,
      toolList,
      think: payload.think,
      stream: payload.stream !== false,
      safeMax,
    });

    const upstreamOrError = await fetchOllamaWithRetry(upstreamPayload, requestController.signal);

    if (upstreamOrError?.errorStatus) {
      if (requestId) ACTIVE_CHAT_REQUESTS.delete(requestId);
      res.writeHead(upstreamOrError.errorStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: upstreamOrError.errorMessage }));
      return;
    }
    const upstream = upstreamOrError;

    res.writeHead(200, {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Push headers immediately so the browser's fetch() resolves and the
    // client-side stream reader begins waiting on bytes without buffering.
    try { res.flushHeaders?.(); } catch { /* ignore */ }
    try { res.socket?.setNoDelay?.(true); } catch { /* ignore */ }
    try { res.socket?.setKeepAlive?.(true, 1000); } catch { /* ignore */ }
    await writeUpstreamBody(upstream, res, requestController.signal);
  } catch (err) {
    const message = err.name === 'AbortError' ? `Ollama API timeout after ${OLLAMA_TIMEOUT_MS}ms` : err.message;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  } finally {
    for (const [id, controller] of ACTIVE_CHAT_REQUESTS.entries()) {
      if (!controller || controller.signal.aborted) {
        ACTIVE_CHAT_REQUESTS.delete(id);
      }
    }
  }
}

function parseRSS(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.trim() || '';
    const desc = block.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    const rawLink = block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim()
      || block.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1]?.trim() || '';
    const cleanLink = rawLink.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    let url = cleanLink;
    try {
      const u = new URL(cleanLink);
      const real = u.searchParams.get('url') || u.searchParams.get('r');
      if (real) url = decodeURIComponent(real);
    } catch {}
    if (title.length > 3) items.push({ title, snippet: desc || title, url });
  }
  return items;
}

async function handleScrape(body) {
  const { url } = JSON.parse(body);
  if (!url?.trim()) return { error: 'URL required' };

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.data?.content) {
        return {
          title: data.data.title || url,
          url: data.data.url || url,
          description: data.data.description || '',
          content: data.data.content,
          isMarkdown: true,
          favicon: `https://www.google.com/s2/favicons?domain=${new URL(data.data.url || url).hostname}&sz=32`,
          html: '',
        };
      }
    }
  } catch {}

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const finalUrl = res.url || url;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&') : url;

  function toAbs(val) {
    if (!val || val.startsWith('data:') || val.startsWith('http')) return val;
    if (val.startsWith('//')) return 'https:' + val;
    try { return new URL(val, finalUrl).href; } catch { return val; }
  }

  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/(\s+src=["'])([^"']+)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`)
    .replace(/(\s+href=["'])([^"'#][^"']*)(["'])/gi, (_, a, v, b) => `${a}${toAbs(v)}${b}`);

  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ').trim();

  return {
    title, url: finalUrl, isMarkdown: false,
    favicon: `https://www.google.com/s2/favicons?domain=${new URL(finalUrl).hostname}&sz=32`,
    html: cleanHtml,
    content: plainText.slice(0, 20000),
    truncated: plainText.length > 20000,
  };
}

async function handleSearch(body) {
  const { query, includeMedia = true, mediaQuery, anchor, strictAnchor = false } = JSON.parse(body);
  if (!query?.trim()) return { error: 'Query required', results: [], media: { videos: [], images: [] } };
  const searchQuery = query.trim();
  const mediaSearchQuery = String(mediaQuery || searchQuery).trim();
  const anchorScope = buildAnchorScope(anchor || (strictAnchor ? mediaSearchQuery : ''));
  const shouldFetchMedia = includeMedia !== false;

  const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
  const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || '';

  const decodeYTText = (s = '') => s.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');

  const YT_BLOCKLIST = new Set([
    'dQw4w9WgXcQ', 'oHg5SJYRHA0', 'xvFZjo5PgG0', 'iik25wqIuFo',
  ]);
  const YT_STOP = new Set(['the','a','an','of','to','for','in','on','with','and','or','but','is','are','was','were','what','how','why','when','where','this','that','it','its','they','them','about','more','can','you','tell','me','please','show','give','find','search','get','some']);
  const ytQueryKeywords = (q) => (q || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !YT_STOP.has(w));

  const youtubePromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const wantsFresh = /\b(latest|current|new|recent|today|this\s+year|202[5-9])\b/i.test(mediaSearchQuery);
      const currentYear = new Date().getUTCFullYear();
      const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(mediaSearchQuery)}&sp=CAMSAhAB`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const html = await r.text();
      // Only parse real "videoRenderer" blocks (actual search results),
      // skipping the recommendations sidebar that loves to surface rickrolls.
      const blocks = html.split('"videoRenderer":').slice(1, 30);
      const seen = new Set();
      const collected = [];
      for (const raw of blocks) {
        const slice = raw.slice(0, 6000);
        const idM = slice.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (!idM) continue;
        const id = idM[1];
        if (seen.has(id) || YT_BLOCKLIST.has(id)) continue;
        const tM = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)
              || slice.match(/"title":\{"simpleText":"([^"]+)"/)
              || slice.match(/"title":\{"accessibility":[\s\S]*?"simpleText":"([^"]+)"/);
        const title = tM ? decodeYTText(tM[1]) : '';
        const pM = slice.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)
              || slice.match(/"publishedTimeText":\{"runs":\[\{"text":"([^"]+)"/);
        const published = pM ? decodeYTText(pM[1]) : '';
        if (wantsFresh) {
          const ageText = `${title} ${published}`.toLowerCase();
          const year = Number(ageText.match(/\b(20\d{2})\b/)?.[1] || 0);
          const yearsAgo = Number(ageText.match(/\b(\d+)\s+years?\s+ago\b/)?.[1] || 0);
          if ((year && year < currentYear - 1) || yearsAgo > 1) continue;
        }
        seen.add(id);
        collected.push({ id, title, published });
      }
      const kw = ytQueryKeywords(mediaSearchQuery);
      let filtered = collected;
      if (strictAnchor && anchorScope?.terms?.length) {
        const scored = collected.map((v) => ({ ...v, score: scoreAgainstAnchor(v.title, anchorScope) }));
        const exact = scored.filter((v) => anchorScope.phraseNorm && v.score >= 10);
        filtered = exact.length ? exact : scored.filter((v) => v.score >= anchorThreshold(anchorScope));
      } else if (kw.length) {
        const weak = new Set(['know', 'which', 'latest', 'current', 'recent', 'video', 'videos', 'media', 'image', 'images']);
        const meaningful = kw.filter((w) => !weak.has(w));
        const required = meaningful.length >= 2 ? 2 : 1;
        const score = (t) => meaningful.reduce((n, w) => n + ((t || '').toLowerCase().includes(w) ? 1 : 0), 0);
        const strict = collected.map((v) => ({ ...v, s: score(v.title) })).filter((v) => v.s >= required);
        if (strict.length) filtered = strict;
      }
      return filtered.slice(0, 6).map(({ id, title }) => ({
        platform: 'youtube',
        videoId: id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        embed: `https://www.youtube.com/embed/${id}`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }));
    } catch { return null; }
  })();

  const instagramPromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:instagram.com ${mediaSearchQuery}`)}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const html = await r.text();
      const re = /instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/g;
      const seen = new Set();
      const out = [];
      let m;
      while ((m = re.exec(html)) !== null && out.length < 3) {
        const kind = m[1];
        const id = m[2];
        const key = `${kind}/${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          platform: 'instagram',
          videoId: id,
          title: `Instagram ${kind === 'reel' ? 'Reel' : 'Post'}`,
          url: `https://www.instagram.com/${kind}/${id}/`,
          embed: `https://www.instagram.com/${kind}/${id}/embed/`,
          thumbnail: '',
        });
      }
      return out.length ? out : null;
    } catch { return null; }
  })();

  const bingImagesPromise = (async () => {
    if (!shouldFetchMedia) return null;
    try {
      const variants = imageQueryVariants(mediaSearchQuery, anchorScope);
      const re = /https:\/\/tse\d\.mm\.bing\.net\/th\/id\/[A-Za-z0-9._-]+(?:\?[^"'\s)<>]+)?/g;
      for (const variant of variants) {
        const r = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(variant)}&form=HDRSC2&first=1`, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) continue;
        const html = await r.text();
        const metadataImages = parseBingImageMetadata(html, variant, anchorScope, strictAnchor);
        if (metadataImages.length) return metadataImages.slice(0, 6);
        if (strictAnchor) continue;
        const seen = new Set();
        const out = [];
        for (const m of html.matchAll(re)) {
          const url = m[0];
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ url, thumbnail: url, title: '', source: `https://www.bing.com/images/search?q=${encodeURIComponent(variant)}` });
          if (out.length >= 6) break;
        }
        if (out.length) return out;
      }
      return null;
    } catch { return null; }
  })();

  const [braveRes, googleRes, bingRes, gnewsRes, ddgRes, videosRes, imagesRes, instagramRes] = await Promise.allSettled([
    BRAVE_KEY ? fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=6`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    (GOOGLE_KEY && GOOGLE_CX) ? fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}&num=6`, {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),

    fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(searchQuery)}&format=rss`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.text() : null),

    fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),

    youtubePromise,
    bingImagesPromise,
    instagramPromise,
  ]);

  // Helper: extract og:image / og:video from an article URL.
  const extractOg = (html, baseUrl) => {
    const pick = (re) => {
      const m = html.match(re);
      if (!m) return '';
      const raw = m[1].replace(/&amp;/g, '&');
      try { return new URL(raw, baseUrl).toString(); } catch { return ''; }
    };
    const image =
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const video =
      pick(/<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
    const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 140);
    return { image, video, title };
  };

  const enrichFromArticles = async (results) => {
    const top = (results || []).filter((r) => r.url && /^https?:\/\//i.test(r.url)).slice(0, 4);
    if (!top.length) return { images: [], videos: [] };
    const fetched = await Promise.all(top.map(async (r) => {
      try {
        const res = await fetch(r.url, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (!/text\/html/i.test(ct)) return null;
        const html = (await res.text()).slice(0, 250000);
        return { html, source: r };
      } catch { return null; }
    }));
    const images = [];
    const videos = [];
    const seenImg = new Set();
    const seenVid = new Set();
    for (const f of fetched) {
      if (!f) continue;
      const og = extractOg(f.html, f.source.url);
      if (og.image && !seenImg.has(og.image)) {
        seenImg.add(og.image);
        images.push({ url: og.image, thumbnail: og.image, title: og.title || f.source.title || '', source: f.source.url });
      }
      if (og.video && !seenVid.has(og.video)) {
        seenVid.add(og.video);
        videos.push({ platform: 'article', url: og.video, embed: og.video, thumbnail: og.image || '', title: og.title || f.source.title || '' });
      }
    }
    return { images, videos };
  };

  // Decide the primary `results` list, then enrich.
  let results;
  let source;
  const brave = braveRes.value?.web?.results;
  const google = googleRes.value?.items;
  if (brave?.length) {
    results = brave.slice(0, 6).map(r => ({ title: r.title, snippet: r.description || r.title, url: r.url }));
    source = 'brave';
  } else if (google?.length) {
    results = google.slice(0, 6).map(r => ({ title: r.title, snippet: r.snippet || r.title, url: r.link }));
    source = 'google';
  } else {
    const bing = bingRes.value ? parseRSS(bingRes.value) : [];
    const gnews = gnewsRes.value ? parseRSS(gnewsRes.value) : [];
    const ddgData = ddgRes.value;
    const ddg = [];
    if (ddgData?.Answer) ddg.push({ title: 'Direct Answer', snippet: ddgData.Answer, url: '' });
    if (ddgData?.AbstractText) ddg.push({ title: ddgData.Heading || searchQuery, snippet: ddgData.AbstractText, url: ddgData.AbstractURL || '' });
    const merged = [...ddg, ...bing, ...gnews];
    const seen = new Set();
    results = merged.filter(r => {
      const key = r.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
    source = results.length ? 'news-rss' : 'none';
  }

  if (strictAnchor) {
    results = filterByAnchor(results, anchorScope, (r) => `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`, true);
  }

  // Validate URLs: drop dead/404 article links before they reach the model or UI.
  if (results?.length) {
    const checks = await Promise.all(results.map(async (r) => {
      if (!r?.url || !/^https?:/i.test(r.url)) return r;
      try {
        const resp = await fetch(r.url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(3500),
        });
        if (resp.status === 405 || resp.status === 403) return r; // server blocks HEAD
        return resp.status < 400 ? r : null;
      } catch { return r; }
    }));
    results = checks.filter(Boolean);
  }

  let resolvedBingImages = imagesRes.value || [];
  if (shouldFetchMedia && strictAnchor) {
    const resultImageQuery = buildResultAnchoredImageQuery(results, anchorScope, mediaSearchQuery);
    if (resultImageQuery && resultImageQuery !== mediaSearchQuery) {
      const resultAnchoredImages = await (async () => {
        try {
          const variants = imageQueryVariants(resultImageQuery, anchorScope);
          for (const variant of variants) {
            const r = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(variant)}&form=HDRSC2&first=1`, {
              headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) continue;
            const metadataImages = parseBingImageMetadata(await r.text(), variant, anchorScope, true);
            if (metadataImages.length) return metadataImages.slice(0, 6);
          }
        } catch {}
        return null;
      })();
      if (Array.isArray(resultAnchoredImages) && resultAnchoredImages.length) {
        resolvedBingImages = resultAnchoredImages;
      }
    }
  }

  const og = await enrichFromArticles(results);

  // Image ordering: article og:image (most relevant) → Bing CDN thumbs (filler).
  const ytVideos = videosRes.value || [];
  const bingImgs = resolvedBingImages;
  const igVideos = instagramRes.value || [];

  const seenImg = new Set();
  const mergedImages = [];
  for (const im of [...og.images, ...bingImgs]) {
    if (!im.url || seenImg.has(im.url)) continue;
    seenImg.add(im.url);
    mergedImages.push(im);
    if (mergedImages.length >= 8) break;
  }

  const seenVid = new Set();
  const mergedVideos = [];
  for (const v of [...ytVideos, ...igVideos, ...og.videos]) {
    const key = v.url || v.embed;
    if (!key || seenVid.has(key)) continue;
    seenVid.add(key);
    mergedVideos.push(v);
    if (mergedVideos.length >= 8) break;
  }

  const media = { videos: mergedVideos, images: mergedImages };
  return { results, media, source };
}

// === Image proxy (dev parity with api/image.js) ===
const IMG_MAX_BYTES = 8 * 1024 * 1024;
const IMG_ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/i;

function imgIsPrivateHost(h) {
  if (!h) return true;
  h = h.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

async function handleImageProxy(req, res) {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const target = parsed.searchParams.get('url') || '';
    let url;
    try { url = new URL(target.trim()); } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid URL' })); return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || imgIsPrivateHost(url.hostname)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Disallowed URL' })); return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageProxy/1.0)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
      },
    });
    clearTimeout(timeout);
    if (!upstream.ok) {
      res.writeHead(502); res.end(JSON.stringify({ error: `Upstream ${upstream.status}` })); return;
    }
    const ct = upstream.headers.get('content-type') || '';
    if (!IMG_ALLOWED_MIME.test(ct.split(';')[0].trim())) {
      res.writeHead(415); res.end(JSON.stringify({ error: `Unsupported content-type: ${ct}` })); return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > IMG_MAX_BYTES) {
      res.writeHead(413); res.end(JSON.stringify({ error: 'Image too large' })); return;
    }
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buffer);
  } catch (err) {
    res.writeHead(504); res.end(JSON.stringify({ error: err?.message || 'Image fetch failed' }));
  }
}

// === Generated image proxy ===
const GEN_IMAGE_MODELS = new Set(['flux', 'turbo']);
const GEN_IMAGE_MAX_PROMPT = 900;

function compactGeneratedPrompt(value = '') {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= GEN_IMAGE_MAX_PROMPT) return compact;
  return compact.slice(0, GEN_IMAGE_MAX_PROMPT).replace(/\s+\S*$/, '').trim();
}

function boundedGeneratedSize(value) {
  const size = Number(value || 1024);
  if (!Number.isFinite(size)) return 1024;
  return Math.max(512, Math.min(1280, Math.round(size)));
}

async function fetchGeneratedImageWithRetries(target) {
  let lastResponse = null;
  let lastError = null;
  const pollinationsKey = String(process.env.POLLINATIONS_API_KEY || '').trim();

  for (let attempt = 0; attempt < GENERATED_IMAGE_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATED_IMAGE_UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-GeneratedImage/1.0)',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(pollinationsKey ? { Authorization: `Bearer ${pollinationsKey}` } : {}),
        },
      });
      clearTimeout(timeout);

      if (upstream.ok) return upstream;
      lastResponse = upstream;

      if (!GENERATED_IMAGE_RETRYABLE_STATUS.has(upstream.status) || attempt === GENERATED_IMAGE_RETRY_ATTEMPTS - 1) {
        return upstream;
      }

      await sleep(900 + (attempt * 900));
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt === GENERATED_IMAGE_RETRY_ATTEMPTS - 1) break;
      await sleep(900 + (attempt * 900));
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error('Image generation failed');
}

async function fetchSearchFallbackImage(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATED_IMAGE_ALT_SEARCH_TIMEOUT_MS);
  try {
    const words = String(prompt || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !GENERATED_IMAGE_SEARCH_STOPWORDS.has(word));
    const compact = words.slice(0, 7).join(' ').trim();
    const queries = [String(prompt || '').trim(), compact, 'elephant swimming', 'wildlife underwater']
      .filter(Boolean)
      .filter((query, index, arr) => arr.indexOf(query) === index);

    let urls = [];
    for (const query of queries) {
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageFallback/1.0)',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'application/json',
        },
      });
      if (!searchRes.ok) continue;
      const payload = await searchRes.json().catch(() => ({}));
      const pages = Object.values(payload?.query?.pages || {});
      urls = pages
        .map((page) => page?.imageinfo?.[0])
        .filter((info) => info?.url && IMG_ALLOWED_MIME.test(String(info?.mime || '').trim()))
        .map((info) => info.url)
        .slice(0, 5);
      if (urls.length) break;
    }

    for (const imageUrl of urls) {
      const imageRes = await fetch(imageUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-ImageFallback/1.0)',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5',
        },
      });
      if (!imageRes.ok) continue;
      const ct = imageRes.headers.get('content-type') || '';
      if (!IMG_ALLOWED_MIME.test(ct.split(';')[0].trim())) continue;
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      if (!buffer.byteLength || buffer.byteLength > 10 * 1024 * 1024) continue;
      return { buffer, contentType: ct };
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGeneratedImage(req, res) {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const prompt = compactGeneratedPrompt(parsed.searchParams.get('prompt') || '');
    if (!prompt) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing prompt' })); return;
    }
    const requestedModel = String(parsed.searchParams.get('model') || 'flux').toLowerCase();
    const model = GEN_IMAGE_MODELS.has(requestedModel) ? requestedModel : 'flux';
    const width = boundedGeneratedSize(parsed.searchParams.get('width'));
    const height = boundedGeneratedSize(parsed.searchParams.get('height'));
    const seed = Number(parsed.searchParams.get('seed') || 1) || 1;
    const params = new URLSearchParams({
      width: String(width),
      height: String(height),
      nologo: 'true',
      enhance: 'true',
      model,
      seed: String(seed),
    });
    const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
    if (key) params.set('key', key);
    const target = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params.toString()}`;
    const upstream = await fetchGeneratedImageWithRetries(target);
    if (!upstream.ok) {
      if (upstream.status === 402 || upstream.status === 403 || upstream.status === 429) {
        const fallback = await fetchSearchFallbackImage(prompt).catch(() => null);
        if (fallback?.buffer) {
          res.writeHead(200, {
            'Content-Type': fallback.contentType,
            'Cache-Control': 'public, max-age=21600',
            'Access-Control-Allow-Origin': '*',
            'X-MIRA-Image-Source': 'search-fallback',
          });
          res.end(fallback.buffer);
          return;
        }
      }
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }));
      return;
    }
    const ct = upstream.headers.get('content-type') || '';
    if (!IMG_ALLOWED_MIME.test(ct.split(';')[0].trim())) {
      res.writeHead(415, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `Unsupported content-type: ${ct}` }));
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > 10 * 1024 * 1024) {
      res.writeHead(413, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Image too large' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buffer);
  } catch (err) {
    res.writeHead(504, { 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: err?.name === 'AbortError' ? 'Image generation timed out' : (err?.message || 'Image generation failed') }));
  }
}

// === Generated video proxy ===
const GEN_VIDEO_MODELS = new Set(['wan-pro', 'wan-pro-1080p']);
const GEN_VIDEO_MAX_PROMPT = 900;
const GEN_VIDEO_RETRY_ATTEMPTS = 3;
const GEN_VIDEO_TIMEOUT_MS = 60000;
const GEN_VIDEO_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const GEN_VIDEO_ALLOWED_MIME = /^video\/(mp4|webm|ogg|quicktime)$/i;
const GEN_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

function compactGeneratedVideoPrompt(value = '') {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= GEN_VIDEO_MAX_PROMPT) return compact;
  return compact.slice(0, GEN_VIDEO_MAX_PROMPT).replace(/\s+\S*$/, '').trim();
}

function boundedVideoDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration)) return 5;
  return Math.max(3, Math.min(12, Math.round(duration)));
}

function resolveVideoUrlFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return '';
  return [
    payload.url,
    payload.video,
    payload.video_url,
    payload.output?.url,
    payload.result?.url,
    payload.data?.url,
    payload.choices?.[0]?.url,
    payload.choices?.[0]?.message?.content,
  ].find((value) => /^https?:\/\//i.test(String(value || '').trim())) || '';
}

async function fetchGeneratedVideoWithRetries(target, key = '') {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < GEN_VIDEO_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEN_VIDEO_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MIRA-GeneratedVideo/1.0)',
          'Accept': 'video/mp4,video/webm,application/json;q=0.9,*/*;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
      });
      clearTimeout(timeout);

      if (upstream.ok) return upstream;
      lastResponse = upstream;
      if (!GEN_VIDEO_RETRYABLE_STATUS.has(upstream.status) || attempt === GEN_VIDEO_RETRY_ATTEMPTS - 1) {
        return upstream;
      }
      await sleep(1200 + (attempt * 1000));
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt === GEN_VIDEO_RETRY_ATTEMPTS - 1) break;
      await sleep(1200 + (attempt * 1000));
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error('Video generation failed');
}

async function handleGeneratedVideo(req, res) {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const prompt = compactGeneratedVideoPrompt(parsed.searchParams.get('prompt') || '');
    if (!prompt) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing prompt' })); return;
    }

    const requestedModel = String(parsed.searchParams.get('model') || process.env.POLLINATIONS_VIDEO_MODEL || 'wan-pro').toLowerCase();
    const model = GEN_VIDEO_MODELS.has(requestedModel) ? requestedModel : 'wan-pro';
    const duration = boundedVideoDuration(parsed.searchParams.get('duration'));
    const resolution = String(parsed.searchParams.get('resolution') || '1080p').toLowerCase();
    const seed = Number(parsed.searchParams.get('seed') || 1) || 1;
    const key = String(process.env.POLLINATIONS_API_KEY || '').trim();

    const params = new URLSearchParams({
      model,
      duration: String(duration),
      resolution,
      seed: String(seed),
      nologo: 'true',
      enhance: 'true',
    });
    if (key) params.set('key', key);
    const target = `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?${params.toString()}`;

    const upstream = await fetchGeneratedVideoWithRetries(target, key);
    if (!upstream.ok) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }));
      return;
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    if (GEN_VIDEO_ALLOWED_MIME.test(contentType)) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.byteLength || buffer.byteLength > GEN_VIDEO_MAX_BYTES) {
        res.writeHead(413, { 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Video too large' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buffer);
      return;
    }

    const payload = await upstream.json().catch(() => ({}));
    const videoUrl = resolveVideoUrlFromPayload(payload);
    if (!videoUrl) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Video URL not returned by upstream' }));
      return;
    }

    const remote = await fetchGeneratedVideoWithRetries(videoUrl, key);
    if (!remote.ok) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `Video fetch failed ${remote.status}` }));
      return;
    }

    const remoteType = (remote.headers.get('content-type') || '').split(';')[0].trim();
    if (!GEN_VIDEO_ALLOWED_MIME.test(remoteType)) {
      res.writeHead(415, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `Unsupported content-type: ${remoteType}` }));
      return;
    }

    const remoteBuffer = Buffer.from(await remote.arrayBuffer());
    if (!remoteBuffer.byteLength || remoteBuffer.byteLength > GEN_VIDEO_MAX_BYTES) {
      res.writeHead(413, { 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Video too large' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': remoteType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(remoteBuffer);
  } catch (err) {
    res.writeHead(504, { 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: err?.name === 'AbortError' ? 'Video generation timed out' : (err?.message || 'Video generation failed') }));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // GET /api/image?url=... — image proxy for CORS-blocked sources
  if (req.method === 'GET' && req.url?.startsWith('/api/image')) {
    await handleImageProxy(req, res);
    return;
  }

  // GET /api/generate-image?prompt=... — generated image bytes
  if (req.method === 'GET' && req.url?.startsWith('/api/generate-image')) {
    await handleGeneratedImage(req, res);
    return;
  }

  // GET /api/generate-video?prompt=... — generated video bytes
  if (req.method === 'GET' && req.url?.startsWith('/api/generate-video')) {
    await handleGeneratedVideo(req, res);
    return;
  }

  if (req.method !== 'POST') { res.writeHead(405); res.end('{}'); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      if (req.url === '/api/chat') { await handleChat(body, res, req); return; }

      let result;
      if (req.url === '/api/scrape') result = await handleScrape(body);
      else if (req.url === '/api/search') result = await handleSearch(body);
      else { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('[dev-api] handler error:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

function tryListen(startPort) {
  const portEnv = process.env.PORT;
  const port = portEnv ? Number(portEnv) : startPort;

  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Dev API port ${port} is already in use. Stop the old dev server and run npm run dev again; Vite proxies /api/* to this exact port.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`Dev API server running on http://localhost:${port}`);
  });
}

tryListen(3002);

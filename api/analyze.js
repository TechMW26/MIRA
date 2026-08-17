import { parseOllamaKeepAlive } from './ollamaConfig.js';

export const config = { maxDuration: 60 };

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OLLAMA_KEEP_ALIVE = parseOllamaKeepAlive(process.env.OLLAMA_VISION_KEEP_ALIVE, 0);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 6000;
const MAX_IMAGES = 6;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif|heic|heif)$/i;
const VISION_REGISTRY_CACHE = { baseUrl: '', expiresAt: 0, selected: null };
const VISION_REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function splitKeys(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Plain delimiter-separated values are supported too.
  }
  return raw.split(/[;,|\s]+/);
}

export function getGeminiApiKeys(env = process.env) {
  const numberedKeys = Object.entries(env || {})
    .filter(([name]) => /^GEMINI_API_KEY_\d+$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, value]) => value);
  return Array.from(new Set([
    env?.GEMINI_API_KEY,
    ...splitKeys(env?.GEMINI_API_KEYS),
    ...splitKeys(env?.GEMINI_FALLBACK_API_KEYS),
    ...numberedKeys,
  ].map((key) => String(key || '').trim()).filter(Boolean)));
}

function registryModelName(entry) {
  return String(entry?.name || entry?.model || '').trim();
}

export function selectVisionRegistryModel(models = []) {
  if (!Array.isArray(models)) return null;
  const selected = models.find((entry) => {
    const name = registryModelName(entry);
    const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
    return Boolean(name) && capabilities.includes('vision');
  });
  if (!selected) return null;
  return {
    name: registryModelName(selected),
    capabilities: Array.isArray(selected.capabilities) ? selected.capabilities : [],
  };
}

function ollamaBaseUrl() {
  return String(process.env.OLLAMA_API_URL || '').trim().replace(/\/api\/.*/i, '');
}

async function fetchVisionRegistryModel(signal) {
  const now = Date.now();
  const baseUrl = ollamaBaseUrl();
  if (!baseUrl) throw new Error('OLLAMA_API_URL is not configured.');
  if (VISION_REGISTRY_CACHE.baseUrl === baseUrl && VISION_REGISTRY_CACHE.selected && VISION_REGISTRY_CACHE.expiresAt > now) {
    return VISION_REGISTRY_CACHE.selected;
  }
  const response = await fetch(`${baseUrl}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Vision model registry request failed (${response.status}).`);
  const payload = await response.json().catch(() => ({}));
  const selected = selectVisionRegistryModel(payload?.models);
  if (!selected) throw new Error('The model registry returned no vision-capable model.');
  VISION_REGISTRY_CACHE.baseUrl = baseUrl;
  VISION_REGISTRY_CACHE.selected = selected;
  VISION_REGISTRY_CACHE.expiresAt = now + VISION_REGISTRY_CACHE_TTL_MS;
  return selected;
}

function normalizeBase64(value = '') {
  return String(value || '')
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .replace(/\s+/g, '');
}

function decodedSize(base64 = '') {
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function buildGeminiVisionPayload({ prompt = '', images = [] } = {}) {
  const cleanPrompt = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_CHARS);
  if (!cleanPrompt) throw new Error('A prompt is required for image analysis.');
  if (!Array.isArray(images) || images.length === 0) throw new Error('At least one image is required.');
  if (images.length > MAX_IMAGES) throw new Error(`A maximum of ${MAX_IMAGES} images can be analyzed at once.`);

  const imageParts = images.map((image) => {
    const mimeType = String(image?.mimeType || image?.type || '').toLowerCase().trim();
    const data = normalizeBase64(image?.base64 || image?.data || '');
    if (!ALLOWED_IMAGE_MIME.test(mimeType)) throw new Error('Unsupported image type.');
    if (!data || !/^[a-z0-9+/]+={0,2}$/i.test(data)) throw new Error('Invalid image data.');
    if (decodedSize(data) > MAX_IMAGE_BYTES) throw new Error('An image exceeds the 8 MB analysis limit.');
    return { inlineData: { mimeType, data } };
  });

  return {
    contents: [{ role: 'user', parts: [{ text: cleanPrompt }, ...imageParts] }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 2048,
    },
  };
}

export function buildOllamaVisionPayload({ registryModel, prompt = '', images = [] } = {}) {
  const validated = buildGeminiVisionPayload({ prompt, images });
  const parts = validated.contents[0].parts;
  return {
    model: registryModel?.name || '',
    messages: [{
      role: 'user',
      content: parts[0].text,
      images: parts.slice(1).map((part) => part.inlineData.data),
    }],
    stream: false,
    think: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    options: {
      temperature: 0.1,
      top_p: 0.8,
      num_predict: 2048,
    },
  };
}

function responseText(payload = {}) {
  return (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => String(part?.text || ''))
    .join('')
    .trim();
}

function safeUpstreamError(payload = {}, status = 502) {
  const message = String(payload?.error?.message || '').replace(/\s+/g, ' ').trim();
  if (status === 429) return 'Image analysis is temporarily rate limited.';
  if (status === 401 || status === 403) return 'An image-analysis credential was rejected.';
  if (status === 404) return 'The configured image-analysis model is unavailable.';
  return message.slice(0, 180) || `Image analysis failed (${status}).`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAttemptSignal(parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), 45_000);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

export async function generateOllamaVisionAnalysis({ prompt, images, signal } = {}) {
  // Validate before touching the registry so malformed input never falls
  // through to a third-party provider.
  buildGeminiVisionPayload({ prompt, images });
  const attemptSignal = createAttemptSignal(signal);
  try {
    const registryModel = await fetchVisionRegistryModel(attemptSignal.signal);
    const payload = buildOllamaVisionPayload({ registryModel, prompt, images });
    const response = await fetch(String(process.env.OLLAMA_API_URL || '').trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: attemptSignal.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(data?.error || data?.message || '').replace(/\s+/g, ' ').trim();
      throw new Error(detail.slice(0, 180) || `Local image analysis failed (${response.status}).`);
    }
    const result = String(data?.message?.content || data?.response || '').trim();
    if (!result) throw new Error('Local image analysis returned no text.');
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error?.name === 'AbortError'
      ? new Error('Local image analysis timed out.')
      : (error instanceof Error ? error : new Error('Local image analysis failed.'));
  } finally {
    attemptSignal.cleanup();
  }
}

export async function generateGeminiVisionAnalysis({ prompt, images, signal } = {}) {
  const payload = buildGeminiVisionPayload({ prompt, images });
  const keys = getGeminiApiKeys();
  const model = String(process.env.GEMINI_VISION_MODEL || '').trim().replace(/^models\//, '');
  if (!keys.length) throw new Error('GEMINI_API_KEYS is not configured.');
  if (!model) throw new Error('GEMINI_VISION_MODEL is not configured.');
  let lastError = new Error('Image analysis failed.');

  for (const key of keys) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptSignal = createAttemptSignal(signal);
      try {
        const response = await fetch(`${GEMINI_API_ROOT}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify(payload),
          signal: attemptSignal.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const result = responseText(data);
          if (result) return result;
          const blockReason = data?.promptFeedback?.blockReason;
          throw new Error(blockReason ? `Image analysis was blocked (${blockReason}).` : 'Image analysis returned no text.');
        }

        lastError = new Error(safeUpstreamError(data, response.status));
        if (!RETRYABLE_STATUS.has(response.status)) break;
        if (attempt === 0) await sleep(300 + Math.floor(Math.random() * 150));
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error?.name === 'AbortError'
          ? new Error('Image analysis timed out.')
          : (error instanceof Error ? error : new Error('Image analysis failed.'));
        if (attempt === 0) await sleep(300 + Math.floor(Math.random() * 150));
      } finally {
        attemptSignal.cleanup();
      }
    }
  }
  throw lastError;
}

export async function generateVisionAnalysis({ prompt, images, signal } = {}) {
  // Validate once up front. Ollama is always primary; Gemini is retained only
  // as a resilience fallback when local vision is unavailable or fails.
  buildGeminiVisionPayload({ prompt, images });
  let localError = null;
  if (String(process.env.OLLAMA_API_URL || '').trim()) {
    try {
      return await generateOllamaVisionAnalysis({ prompt, images, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      localError = error;
    }
  }

  try {
    return await generateGeminiVisionAnalysis({ prompt, images, signal });
  } catch (fallbackError) {
    if (localError && /not configured/i.test(String(fallbackError?.message || ''))) {
      throw localError;
    }
    throw fallbackError;
  }
}

export async function POST(req) {
  try {
    const contentLength = Number(req.headers?.get?.('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'Request body is too large.' }, 413);
    const body = await req.json();
    if (JSON.stringify(body).length > MAX_BODY_BYTES) return json({ error: 'Request body is too large.' }, 413);
    const result = await generateVisionAnalysis({
      prompt: body?.prompt,
      images: body?.images,
      signal: req.signal,
    });
    return json({ result });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Image analysis was cancelled.'
      : (error?.message || 'Image analysis failed.');
    const status = /required|unsupported|invalid|maximum|exceeds/i.test(message) ? 400
      : (/not configured/i.test(message) ? 503 : 502);
    return json({ error: message }, status);
  }
}

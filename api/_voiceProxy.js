const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function voiceConfig() {
  const url = String(process.env.MIRA_VOICE_API_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.MIRA_VOICE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
  return { url, key };
}

export function safeVoiceError(error, fallback) {
  return error?.code === 'VOICE_NOT_CONFIGURED'
    ? 'Voice mode is not configured on this deployment.'
    : fallback;
}

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function voiceFetch(path, options = {}, { attempts = 2, timeoutMs = 120_000 } = {}) {
  const { url, key } = voiceConfig();
  if (!url || !key) {
    const error = new Error('Voice service is not configured.');
    error.code = 'VOICE_NOT_CONFIGURED';
    throw error;
  }

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${url}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt + 1 >= attempts) {
        return response;
      }
      await response.body?.cancel?.().catch(() => {});
      lastError = new Error(`Voice service returned ${response.status}.`);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      if (attempt + 1 >= attempts) throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener?.('abort', onAbort);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error('Voice service request failed.');
}

export async function proxyError(response, fallback, status = response?.status || 503) {
  const payload = await response?.json?.().catch(() => ({}));
  return json({ error: String(payload?.detail || payload?.error || fallback) }, status);
}

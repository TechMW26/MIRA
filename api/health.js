export const config = { maxDuration: 10 };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function ollamaBaseUrl() {
  return String(process.env.OLLAMA_API_URL || '').trim().replace(/\/api\/.*/i, '');
}

async function fetchWithRetry(url, signal) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (response.ok || attempt > 0) return response;
      lastError = new Error(`Health probe failed (${response.status}).`);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error('Health probe failed.');
}

export async function GET(req) {
  const startedAt = Date.now();
  const baseUrl = ollamaBaseUrl();
  if (!baseUrl) {
    return json({ ready: false, registryReachable: false, loadedModelCount: 0, latencyMs: 0 }, 503);
  }

  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  if (req?.signal?.aborted) abortFromClient();
  else req?.signal?.addEventListener?.('abort', abortFromClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const [tagsResult, psResult] = await Promise.allSettled([
      fetchWithRetry(`${baseUrl}/api/tags`, controller.signal),
      fetchWithRetry(`${baseUrl}/api/ps`, controller.signal),
    ]);
    if (tagsResult.status !== 'fulfilled') throw tagsResult.reason;
    const tagsResponse = tagsResult.value;
    const psResponse = psResult.status === 'fulfilled' ? psResult.value : null;
    const tags = await tagsResponse.json().catch(() => ({}));
    const ps = psResponse ? await psResponse.json().catch(() => ({})) : {};
    const models = Array.isArray(tags?.models) ? tags.models : [];
    const completionModelCount = models.filter((model) => {
      const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
      return capabilities.length === 0 || capabilities.includes('completion');
    }).length;
    const loadedModelCount = Array.isArray(ps?.models) ? ps.models.length : 0;
    const registryReachable = tagsResponse.ok;
    const ready = registryReachable && completionModelCount > 0;
    return json({
      ready,
      registryReachable,
      completionModelCount,
      loadedModelCount,
      latencyMs: Date.now() - startedAt,
    }, ready ? 200 : 503);
  } catch (error) {
    return json({
      ready: false,
      registryReachable: false,
      loadedModelCount: 0,
      latencyMs: Date.now() - startedAt,
      reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable',
    }, 503);
  } finally {
    clearTimeout(timeout);
    req?.signal?.removeEventListener?.('abort', abortFromClient);
  }
}

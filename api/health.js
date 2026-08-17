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
    const [tagsResponse, psResponse] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, { signal: controller.signal, cache: 'no-store' }),
      fetch(`${baseUrl}/api/ps`, { signal: controller.signal, cache: 'no-store' }),
    ]);
    const tags = await tagsResponse.json().catch(() => ({}));
    const ps = await psResponse.json().catch(() => ({}));
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

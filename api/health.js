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

function configuredProviders() {
  const providers = [];
  if (String(process.env.MIRA_OPENAI_BASE_URL || process.env.MIRA_BASE_URL || '').trim()) {
    providers.push('mira');
  }
  if (String(process.env.DEEPSEEK_API_KEY || '').trim()) providers.push('deepseek');
  return providers;
}

export async function GET() {
  const startedAt = Date.now();
  const providers = configuredProviders();
  const ready = providers.length > 0;
  const count = providers.length;
  return json({
    ready,
    registryReachable: ready,
    completionModelCount: count,
    loadedModelCount: count,
    modelWarm: ready,
    state: ready ? 'ready' : 'unconfigured',
    providers,
    latencyMs: Date.now() - startedAt,
  }, ready ? 200 : 503);
}

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
  const miraUrl = String(process.env.MIRA_OPENAI_BASE_URL || process.env.MIRA_BASE_URL || '').trim();
  const miraToken = String(process.env.MIRA_API_TOKEN || '').trim();
  if (miraUrl && miraToken) {
    providers.push('mira');
  }
  if (String(process.env.DEEPSEEK_API_KEY || '').trim()) providers.push('deepseek');
  return providers;
}

export async function GET() {
  const startedAt = Date.now();
  const providers = configuredProviders();
  const ready = providers.includes('mira');
  const count = providers.length;
  const miraEndpointConfigured = Boolean(String(
    process.env.MIRA_OPENAI_BASE_URL || process.env.MIRA_BASE_URL || '',
  ).trim());
  return json({
    ready,
    registryReachable: ready,
    completionModelCount: count,
    loadedModelCount: count,
    modelWarm: ready,
    state: ready ? 'ready' : (miraEndpointConfigured ? 'mira-credential-missing' : 'unconfigured'),
    primaryProvider: 'mira',
    providers,
    latencyMs: Date.now() - startedAt,
  }, ready ? 200 : 503);
}

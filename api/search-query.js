import { formSearchQuery } from './_searchQuery.js';
import { guardRequest } from './_requestSecurity.js';
import { buildUpstreamPayload, selectRegistryModel } from './chat.js';

export const config = { maxDuration: 30 };

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^```(?:text)?|```$/gi, '')
    .replace(/^(?:query|search query)\s*:\s*/i, '')
    .replace(/^[-*\s"'`]+|[-*\s"'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function requestOllamaQuery({ latestMessage, context, signal }) {
  const chatUrl = String(process.env.OLLAMA_API_URL || '').trim();
  const baseUrl = chatUrl.replace(/\/api\/.*/i, '');
  if (!chatUrl || !baseUrl) throw new Error('Ollama is not configured.');

  const [registryResponse, residencyResponse] = await Promise.all([
    fetch(`${baseUrl}/api/tags`, { signal, cache: 'no-store' }),
    fetch(`${baseUrl}/api/ps`, { signal, cache: 'no-store' }).catch(() => null),
  ]);
  if (!registryResponse.ok) throw new Error('Ollama registry is unavailable.');
  const registry = await registryResponse.json().catch(() => ({}));
  const residency = residencyResponse?.ok
    ? await residencyResponse.json().catch(() => ({}))
    : {};
  const residentNames = (Array.isArray(residency?.models) ? residency.models : [])
    .map((model) => String(model?.name || model?.model || '').trim())
    .filter(Boolean);
  const selected = selectRegistryModel(registry?.models, process.env.OLLAMA_CHAT_MODEL, {
    residentNames,
  });
  if (!selected) throw new Error('No Ollama completion model is available.');

  const prompt = [
    'Create one search-engine-ready web query for MIRA.',
    'Resolve pronouns and follow-up phrases from the supplied conversation context.',
    'Preserve identity constraints such as full name, city, profession, company, platform, date, and requested fact.',
    'Prefer the specific entity from the immediately preceding exchange over generic words in the latest message.',
    'Return only the concise query text with no explanation, label, Markdown, quotes, or tool syntax.',
    `LATEST MESSAGE:\n${latestMessage}`,
    `CONVERSATION CONTEXT:\n${context || '(none)'}`,
  ].join('\n\n');
  const payload = buildUpstreamPayload({
    registryModel: selected,
    messages: [{ role: 'user', content: prompt }],
    think: false,
    maxTokens: 128,
    tools: [],
  });
  payload.stream = false;
  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Ollama query planner returned ${response.status}.`);
  const result = await response.json().catch(() => ({}));
  return cleanQuery(result?.message?.content || result?.response || '');
}

export async function POST(req) {
  const blocked = guardRequest(req, { limit: 40, windowMs: 60_000, key: 'search-query' });
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const latestMessage = String(body?.latestMessage || '').trim().slice(0, 2_000);
    const context = String(body?.context || '').trim().slice(0, 8_000);
    const fallback = await formSearchQuery({
      latestMessage: body?.latestMessage,
      context: body?.context,
    });
    if (!latestMessage) {
      return Response.json({ query: '', source: 'empty' });
    }

    let query = cleanQuery(fallback?.query);
    let source = 'deterministic-fallback';
    if (String(process.env.OLLAMA_API_URL || '').trim()) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const aiQuery = await requestOllamaQuery({ latestMessage, context, signal: controller.signal });
          if (aiQuery) {
            query = aiQuery;
            source = 'ollama';
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        // Search must remain available during a query-planner outage.
      }
    }

    return new Response(JSON.stringify({ query, source }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || 'Could not form search query.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

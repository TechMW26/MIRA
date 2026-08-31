import { formSearchQuery } from './_searchQuery.js';
import { guardRequest } from './_requestSecurity.js';
import { requestDeepSeekChat } from './code-assist.js';

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

async function requestDeepSeekQuery({ latestMessage, context, signal }) {
  const prompt = [
    'Create one search-engine-ready web query for MIRA.',
    'Resolve pronouns and follow-up phrases from the supplied conversation context.',
    'Preserve identity constraints such as full name, city, profession, company, platform, date, and requested fact.',
    'Prefer the specific entity from the immediately preceding exchange over generic words in the latest message.',
    'Return only the concise query text with no explanation, label, Markdown, quotes, or tool syntax.',
    `LATEST MESSAGE:\n${latestMessage}`,
    `CONVERSATION CONTEXT:\n${context || '(none)'}`,
  ].join('\n\n');
  const result = await requestDeepSeekChat({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: 'You are a concise search-query planner for MIRA.',
    maxTokens: 256,
    think: false,
    signal,
  });
  return cleanQuery(result.answer || '');
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
    if (String(process.env.DEEPSEEK_API_KEY || '').trim()) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const aiQuery = await requestDeepSeekQuery({ latestMessage, context, signal: controller.signal });
          if (aiQuery) {
            query = aiQuery;
            source = 'deepseek';
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

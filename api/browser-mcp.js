export const config = { maxDuration: 120 };

const MCP_URL = String(process.env.MIRA_BROWSER_MCP_URL || '').trim();
const MCP_TOKEN = String(process.env.MIRA_BROWSER_MCP_TOKEN || '').trim();
const MCP_TOOL_NAME = String(process.env.MIRA_BROWSER_MCP_TOOL || 'browser.inspectWebsite').trim();

function parseToolResult(payload = {}) {
  if (payload.error) throw new Error(payload.error?.message || payload.error || 'Browser MCP tool failed.');
  const result = payload.result || payload;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((item) => item?.type === 'text' && item?.text).map((item) => item.text).join('\n');
  if (text) {
    try { return JSON.parse(text); } catch { return { summary: text }; }
  }
  return result?.structuredContent || result?.documentation || result;
}

function parseMcpResponse(raw = '') {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch { /* try SSE below */ }
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    if (!dataLines[index] || dataLines[index] === '[DONE]') continue;
    try { return JSON.parse(dataLines[index]); } catch { /* continue */ }
  }
  throw new Error('Browser MCP gateway returned an unreadable response.');
}

export async function POST(req) {
  if (!MCP_URL) {
    return new Response(JSON.stringify({ error: 'MIRA_BROWSER_MCP_URL is not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await req.json();
    const url = String(body?.url || '').trim();
    const task = String(body?.task || 'Inspect and document this website.').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('A public HTTP(S) URL is required.');
    const upstream = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `mira-browser-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAME,
          arguments: { url, task, include: ['structure', 'accessibility', 'source', 'links', 'metadata'] },
        },
      }),
      signal: AbortSignal.timeout(110000),
    });
    const raw = await upstream.text();
    if (!upstream.ok) throw new Error(`Browser MCP gateway failed (${upstream.status}): ${raw.slice(0, 300)}`);
    return new Response(JSON.stringify({ documentation: parseToolResult(parseMcpResponse(raw)) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || 'Browser MCP request failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

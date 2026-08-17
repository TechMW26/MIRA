import http from 'http';
import fs from 'fs';
import path from 'path';

function loadDotEnv() {
  try {
    const externallyDefined = new Set(Object.keys(process.env));
    for (const filename of ['.env', '.env.local']) {
      const envPath = path.resolve(process.cwd(), filename);
      if (!fs.existsSync(envPath)) continue;
      const text = fs.readFileSync(envPath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!externallyDefined.has(key)) process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('dev-api: failed to load .env:', error.message);
  }
}

loadDotEnv();

const PORT = Number(process.env.API_PORT || 3002);
const ROUTES = new Map([
  ['/api/chat', './api/chat.js'],
  ['/api/health', './api/health.js'],
  ['/api/analyze', './api/analyze.js'],
  ['/api/analyse', './api/analyse.js'],
  ['/api/search', './api/search.js'],
  ['/api/search-query', './api/search-query.js'],
  ['/api/browser-mcp', './api/browser-mcp.js'],
  ['/api/image', './api/image.js'],
  ['/api/generate-image', './api/generate-image.js'],
  ['/api/generate-video', './api/generate-video.js'],
  ['/api/media', './api/media.js'],
  ['/api/cleanup-media', './api/cleanup-media.js'],
]);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function writeResponse(webResponse, res, abortController) {
  const headers = Object.fromEntries(webResponse.headers.entries());
  res.writeHead(webResponse.status, { ...headers, ...corsHeaders() });
  try { res.flushHeaders?.(); } catch {}

  const reader = webResponse.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  try {
    while (!abortController.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  } catch {
    // Client disconnects and upstream stream closures are expected here.
  } finally {
    reader.cancel().catch?.(() => {});
    if (!res.writableEnded) res.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  const modulePath = ROUTES.get(requestUrl.pathname);
  if (!modulePath) {
    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error: 'Not found.' }));
    return;
  }

  const abortController = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : await readBody(req);
    const webRequest = new Request(requestUrl, {
      method: req.method,
      headers: req.headers,
      body,
      signal: abortController.signal,
      duplex: body ? 'half' : undefined,
    });
    const module = await import(modulePath);
    const handler = module[req.method || 'GET'];
    if (typeof handler !== 'function') {
      res.writeHead(405, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ error: 'Method not allowed.' }));
      return;
    }
    const webResponse = await handler(webRequest);
    await writeResponse(webResponse, res, abortController);
  } catch (error) {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(error?.name === 'AbortError' ? 499 : 500, {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    });
    res.end(JSON.stringify({ error: error?.message || 'Local API request failed.' }));
  }
});

server.listen(PORT, () => {
  console.log(`MIRA local API listening on http://localhost:${PORT}`);
});

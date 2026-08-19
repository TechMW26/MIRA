import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './health.js';

test('reports sanitized Ollama readiness without exposing model names', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.OLLAMA_API_URL;
  process.env.OLLAMA_API_URL = 'http://ollama.test:11434/api/chat';
  globalThis.fetch = async (url) => new Response(JSON.stringify(
    String(url).endsWith('/api/tags')
      ? { models: [{ name: 'private-model-name', capabilities: ['completion', 'thinking'] }] }
      : { models: [{ name: 'private-model-name' }] },
  ), { status: 200 });

  try {
    const response = await GET(new Request('http://localhost/api/health'));
    const text = await response.text();
    const payload = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(payload.ready, true);
    assert.equal(payload.loadedModelCount, 1);
    assert.equal(text.includes('private-model-name'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalUrl;
  }
});

test('keeps readiness healthy when only the optional residency probe fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.OLLAMA_API_URL;
  process.env.OLLAMA_API_URL = 'http://ollama.test:11434/api/chat';
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/ps')) throw new TypeError('temporary connection failure');
    return new Response(JSON.stringify({
      models: [{ name: 'runtime-model', capabilities: ['completion'] }],
    }), { status: 200 });
  };

  try {
    const response = await GET(new Request('http://localhost/api/health'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ready, true);
    assert.equal(payload.registryReachable, true);
    assert.equal(payload.loadedModelCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalUrl;
  }
});

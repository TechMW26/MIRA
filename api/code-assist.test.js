import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, selectAssistModel } from './code-assist.js';

test('selects a fast coding-capable Pollinations model dynamically', () => {
  assert.equal(selectAssistModel([
    { name: 'general', description: 'General chat', output_modalities: ['text'] },
    { name: 'quick-code', description: 'Fast affordable coding assistant', output_modalities: ['text'], tools: true },
  ]), 'quick-code');
});

test('keeps Pollinations credentials server-side for code completion', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  const requests = [];
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/text/models')) {
      return new Response(JSON.stringify([{ name: 'quick-code', description: 'Fast coding', output_modalities: ['text'] }]), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'return value;' } }] }), { status: 200 });
  };
  try {
    const response = await POST(new Request('http://localhost/api/code-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'completion', path: 'src/a.js', language: 'javascript', prefix: 'function run() {', suffix: '}' }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).suggestion, 'return value;');
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer server-secret');
    assert.doesNotMatch(requests.at(-1).options.body, /server-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

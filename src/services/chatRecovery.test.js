import test from 'node:test';
import assert from 'node:assert/strict';
import { runChatCompletion } from './api.js';

test('diagnoses and retries one transient chat failure', async () => {
  const originalFetch = globalThis.fetch;
  let generationAttempts = 0;
  let cancellationCalls = 0;
  let healthCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === '/api/health') {
      healthCalls += 1;
      return new Response(JSON.stringify({
        ready: true,
        registryReachable: true,
        loadedModelCount: 1,
        latencyMs: 5,
      }), { status: 200 });
    }

    const body = JSON.parse(options.body || '{}');
    if (body.action === 'cancel') {
      cancellationCalls += 1;
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }

    generationAttempts += 1;
    if (generationAttempts === 1) {
      return new Response(JSON.stringify({ error: 'Model temporarily unavailable.' }), { status: 503 });
    }
    return new Response(`${JSON.stringify({ message: { content: 'Recovered response.' }, done: true })}\n`, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  };

  try {
    const response = await runChatCompletion({
      messages: [{ role: 'user', content: 'Hello' }],
      think: false,
    });
    assert.equal(response.result, 'Recovered response.');
    assert.equal(generationAttempts, 2);
    assert.equal(cancellationCalls, 1);
    assert.equal(healthCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJinaSearchPayload, searchJina } from './_jinaSearch.js';

test('normalizes Jina search results into the global evidence contract', () => {
  assert.deepEqual(parseJinaSearchPayload({ data: [{
    title: 'Example company',
    url: 'https://example.com',
    content: 'Official company profile and current product information.',
  }] }), [{
    title: 'Example company',
    url: 'https://example.com',
    snippet: 'Official company profile and current product information.',
    provider: 'jina',
  }]);
});

test('coalesces and caches repeated Jina searches', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JINA_API_KEY;
  let calls = 0;
  process.env.JINA_API_KEY = 'jina-test-key';
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ data: [{
      title: 'Cached result',
      url: 'https://example.com/cached',
      content: 'One upstream request should satisfy every duplicate search.',
    }] });
  };
  try {
    const query = `cache-check-${Date.now()}`;
    const [first, second] = await Promise.all([searchJina(query), searchJina(query)]);
    const third = await searchJina(query);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.JINA_API_KEY;
    else process.env.JINA_API_KEY = originalKey;
  }
});

test('opens a short circuit after a Jina service failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.JINA_API_KEY;
  let calls = 0;
  process.env.JINA_API_KEY = 'jina-test-key';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('', { status: 503 });
  };
  try {
    assert.equal(await searchJina(`failure-check-${Date.now()}`), null);
    assert.equal(await searchJina(`circuit-check-${Date.now()}`), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.JINA_API_KEY;
    else process.env.JINA_API_KEY = originalKey;
  }
});

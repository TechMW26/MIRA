import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollinationsUrl,
  GET,
} from './generate-image.js';

test('builds image requests only on the unified Pollinations origin using flux', () => {
  const url = new URL(buildPollinationsUrl({
    prompt: 'an elephant',
    seed: 7,
    width: 1024,
    height: 1024,
  }));
  assert.equal(url.origin, 'https://gen.pollinations.ai');
  assert.equal(url.pathname, '/image/an%20elephant');
  assert.equal(url.searchParams.get('model'), 'flux');
  assert.equal(url.searchParams.has('key'), false);
});

test('requires a server-side Pollinations key', async () => {
  const originalKey = process.env.POLLINATIONS_API_KEY;
  delete process.env.POLLINATIONS_API_KEY;
  try {
    const response = await GET(new Request('http://localhost/api/generate-image?prompt=an%20elephant'));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /POLLINATIONS_API_KEY/);
  } finally {
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('generates only with flux and uses bearer authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  const requests = [];
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), authorization: options.headers?.Authorization });
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  };

  try {
    const response = await GET(new Request('http://localhost/api/generate-image?prompt=an%20elephant'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-image-provider'), 'pollinations');
    assert.equal(requests.length, 1);
    assert.ok(requests.every((request) => request.url.startsWith('https://gen.pollinations.ai/')));
    assert.ok(requests.every((request) => request.authorization === 'Bearer server-secret'));
    assert.equal(new URL(requests[0].url).searchParams.get('model'), 'flux');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

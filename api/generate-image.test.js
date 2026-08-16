import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollinationsUrl,
  clearPollinationsModelCache,
  GET,
  parsePollinationsImageModels,
} from './generate-image.js';

test('accepts only live registry entries that can output images', () => {
  assert.deepEqual(parsePollinationsImageModels([
    { id: 'image-model', outputModalities: ['image'] },
    { id: 'video-model', outputModalities: ['video'] },
    { id: 'legacy-unspecified' },
  ]), ['image-model', 'legacy-unspecified']);
});

test('builds image requests only on the unified Pollinations origin', () => {
  const url = new URL(buildPollinationsUrl({
    prompt: 'an elephant',
    model: 'registry-model',
    seed: 7,
    width: 1024,
    height: 1024,
  }));
  assert.equal(url.origin, 'https://gen.pollinations.ai');
  assert.equal(url.pathname, '/image/an%20elephant');
  assert.equal(url.searchParams.get('model'), 'registry-model');
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

test('discovers a Pollinations image model and uses bearer authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  const originalModel = process.env.POLLINATIONS_IMAGE_MODEL;
  const requests = [];
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  delete process.env.POLLINATIONS_IMAGE_MODEL;
  clearPollinationsModelCache();
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), authorization: options.headers?.Authorization });
    if (String(url).endsWith('/image/models')) {
      return new Response(JSON.stringify([{ id: 'live-image-model', outputModalities: ['image'] }]), { status: 200 });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  };

  try {
    const response = await GET(new Request('http://localhost/api/generate-image?prompt=an%20elephant'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-image-provider'), 'pollinations');
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url.startsWith('https://gen.pollinations.ai/')));
    assert.ok(requests.every((request) => request.authorization === 'Bearer server-secret'));
    assert.match(requests[1].url, /model=live-image-model/);
  } finally {
    globalThis.fetch = originalFetch;
    clearPollinationsModelCache();
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.POLLINATIONS_IMAGE_MODEL;
    else process.env.POLLINATIONS_IMAGE_MODEL = originalModel;
  }
});

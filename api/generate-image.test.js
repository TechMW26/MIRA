import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollinationsPayload,
  GET,
} from './generate-image.js';

test('uses Klein for fresh images and cannot accept a client-selected model', () => {
  const payload = buildPollinationsPayload({
    prompt: 'an elephant',
    width: 1024,
    height: 1024,
    model: 'zimage',
  });
  assert.equal(payload.model, 'klein');
  assert.equal(payload.image, undefined);
  assert.equal(payload.response_format, 'b64_json');
});

test('uses Kontext and sends the exact previous image for edits', () => {
  const payload = buildPollinationsPayload({
    prompt: 'make the sky blue',
    width: 1024,
    height: 1024,
    referenceImage: 'https://blob.example/previous.png',
  });
  assert.equal(payload.model, 'kontext');
  assert.equal(payload.image, 'https://blob.example/previous.png');
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

test('posts a fresh generation to Pollinations with Klein and bearer authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  const requests = [];
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      created: Date.now(),
      data: [{ b64_json: Buffer.from([137, 80, 78, 71]).toString('base64'), media_type: 'image/png' }],
      usage: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await GET(new Request('http://localhost/api/generate-image?prompt=an%20elephant'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-image-mode'), 'generate');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://gen.pollinations.ai/v1/images/generations');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer server-secret');
    assert.equal(requests[0].body.model, 'klein');
    assert.equal(requests[0].body.image, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('posts edits with Kontext and the previous image reference', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  let body;
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (_url, options = {}) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      created: Date.now(),
      data: [{ b64_json: Buffer.from([255, 216, 255, 0]).toString('base64'), media_type: 'image/jpeg' }],
      usage: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const requestUrl = new URL('http://localhost/api/generate-image');
    requestUrl.searchParams.set('prompt', 'make the sky blue');
    requestUrl.searchParams.set('referenceImage', 'https://blob.example/previous.png');
    const response = await GET(new Request(requestUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-image-mode'), 'edit');
    assert.equal(body.model, 'kontext');
    assert.equal(body.image, 'https://blob.example/previous.png');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('surfaces rejected provider credentials without retrying', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  let attempts = 0;
  process.env.POLLINATIONS_API_KEY = 'stale-server-secret';
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = await GET(new Request('http://localhost/api/generate-image?prompt=an%20elephant'));
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-mira-upstream-status'), '401');
    assert.equal(payload.code, 'provider_authentication_failed');
    assert.match(payload.error, /credential/i);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

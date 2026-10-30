import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollinationsVisionPayload,
  generatePollinationsVisionAnalysis,
  generateVisionAnalysis,
  POST,
} from './analyze.js';

test('builds Pollinations vision requests only when image input is present', () => {
  assert.throws(
    () => buildPollinationsVisionPayload({ prompt: 'Explain this', images: [] }),
    /image is required/i,
  );
  const payload = buildPollinationsVisionPayload({
    prompt: 'Read this image',
    images: [{ mimeType: 'image/png', base64: 'YWJj' }],
  });
  assert.equal(payload.model, 'openai');
  assert.deepEqual(payload.messages[0].content[0], { type: 'text', text: 'Read this image' });
  assert.deepEqual(payload.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,YWJj' },
  });
});

test('honors an explicit Pollinations vision model override', () => {
  const previous = process.env.POLLINATIONS_VISION_MODEL;
  process.env.POLLINATIONS_VISION_MODEL = 'gpt-4o';
  try {
    const payload = buildPollinationsVisionPayload({
      prompt: 'Read this image',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(payload.model, 'gpt-4o');
  } finally {
    if (previous === undefined) delete process.env.POLLINATIONS_VISION_MODEL;
    else process.env.POLLINATIONS_VISION_MODEL = previous;
  }
});

test('streams image analysis through Pollinations with bearer authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  process.env.POLLINATIONS_API_KEY = 'pollinations-secret';
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = { url: String(url), options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Visible image details' } }],
    }), { status: 200 });
  };

  try {
    const result = await generatePollinationsVisionAnalysis({
      prompt: 'Describe it',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(result, 'Visible image details');
    assert.equal(upstream.url, 'https://gen.pollinations.ai/v1/chat/completions');
    assert.equal(upstream.options.headers.Authorization, 'Bearer pollinations-secret');
    assert.doesNotMatch(upstream.options.body, /pollinations-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('requires a server-side Pollinations key for image analysis', async () => {
  const previousKey = process.env.POLLINATIONS_API_KEY;
  delete process.env.POLLINATIONS_API_KEY;
  try {
    const response = await POST(new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Describe it',
        images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
      }),
    }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /POLLINATIONS_API_KEY/i);
  } finally {
    if (previousKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = previousKey;
  }
});

test('runs Pollinations as the single vision provider', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  const calls = [];
  process.env.POLLINATIONS_API_KEY = 'vision-key';
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Pollinations visual details' } }],
    }), { status: 200 });
  };

  try {
    const result = await generateVisionAnalysis({
      prompt: 'Describe it',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(result, 'Pollinations visual details');
    assert.equal(calls.some((url) => url.includes('gen.pollinations.ai')), true);
    assert.equal(calls.some((url) => url.includes('googleapis.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('rejects text-only requests before calling Pollinations', async () => {
  const response = await POST(new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Write text', images: [] }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /image is required/i);
});

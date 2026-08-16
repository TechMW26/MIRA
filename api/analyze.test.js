import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiVisionPayload,
  generateVisionAnalysis,
  getGeminiApiKeys,
  POST,
} from './analyze.js';

test('builds Gemini requests only when image input is present', () => {
  assert.throws(
    () => buildGeminiVisionPayload({ prompt: 'Explain this', images: [] }),
    /image is required/i,
  );
  const payload = buildGeminiVisionPayload({
    prompt: 'Read this image',
    images: [{ mimeType: 'image/png', base64: 'YWJj' }],
  });
  assert.equal(payload.contents[0].parts[0].text, 'Read this image');
  assert.deepEqual(payload.contents[0].parts[1].inlineData, {
    mimeType: 'image/png',
    data: 'YWJj',
  });
});

test('loads a deduplicated ordered Gemini key fallback chain', () => {
  assert.deepEqual(getGeminiApiKeys({
    GEMINI_API_KEY: 'primary',
    GEMINI_API_KEYS: 'primary,secondary',
    GEMINI_FALLBACK_API_KEYS: '["third", "secondary"]',
    GEMINI_API_KEY_4: 'fourth',
  }), ['primary', 'secondary', 'third', 'fourth']);
});

test('falls back to the next Gemini key after a rejected credential', async () => {
  const originalFetch = globalThis.fetch;
  const originalKeys = process.env.GEMINI_API_KEYS;
  const originalModel = process.env.GEMINI_VISION_MODEL;
  const attemptedKeys = [];
  process.env.GEMINI_API_KEYS = 'rejected-key,working-key';
  process.env.GEMINI_VISION_MODEL = 'configured-vision-model';
  globalThis.fetch = async (_url, options) => {
    attemptedKeys.push(options.headers['x-goog-api-key']);
    if (attemptedKeys.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'Rejected' } }), { status: 403 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Visible image details' }] } }],
    }), { status: 200 });
  };

  try {
    const result = await generateVisionAnalysis({
      prompt: 'Describe it',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(result, 'Visible image details');
    assert.deepEqual(attemptedKeys, ['rejected-key', 'working-key']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = originalKeys;
    if (originalModel === undefined) delete process.env.GEMINI_VISION_MODEL;
    else process.env.GEMINI_VISION_MODEL = originalModel;
  }
});

test('rejects text-only requests before calling Gemini', async () => {
  const response = await POST(new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Write text', images: [] }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /image is required/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiVisionPayload,
  buildOllamaVisionPayload,
  generateGeminiVisionAnalysis,
  generateVisionAnalysis,
  getGeminiApiKeys,
  POST,
  selectVisionRegistryModel,
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

test('selects the vision-capable model from the dynamic registry', () => {
  assert.deepEqual(selectVisionRegistryModel([
    { name: 'chat-model', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'vision-model', capabilities: ['completion', 'vision'] },
  ]), {
    name: 'vision-model',
    capabilities: ['completion', 'vision'],
  });
});

test('builds an Ollama vision request with validated image data', () => {
  const payload = buildOllamaVisionPayload({
    registryModel: { name: 'vision-model' },
    prompt: 'Read this image',
    images: [{ mimeType: 'image/png', base64: 'YWJj' }],
  });
  assert.equal(payload.model, 'vision-model');
  assert.equal(payload.think, false);
  assert.equal(payload.keep_alive, 0);
  assert.deepEqual(payload.messages[0].images, ['YWJj']);
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
    const result = await generateGeminiVisionAnalysis({
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

test('uses local vision before Gemini', async () => {
  const originalFetch = globalThis.fetch;
  const originalOllamaUrl = process.env.OLLAMA_API_URL;
  const calls = [];
  process.env.OLLAMA_API_URL = 'http://local-vision.test:11434/api/chat';
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({
        models: [
          { name: 'chat-model', capabilities: ['completion', 'thinking'] },
          { name: 'vision-model', capabilities: ['completion', 'vision'] },
        ],
      }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'vision-model');
    return new Response(JSON.stringify({ message: { content: 'Local visual details' } }), { status: 200 });
  };

  try {
    const result = await generateVisionAnalysis({
      prompt: 'Describe it',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(result, 'Local visual details');
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.includes('googleapis.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalOllamaUrl;
  }
});

test('uses Gemini only when local vision is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalOllamaUrl = process.env.OLLAMA_API_URL;
  const originalKeys = process.env.GEMINI_API_KEYS;
  const originalModel = process.env.GEMINI_VISION_MODEL;
  const calls = [];
  process.env.OLLAMA_API_URL = 'http://no-vision.test:11434/api/chat';
  process.env.GEMINI_API_KEYS = 'fallback-key';
  process.env.GEMINI_VISION_MODEL = 'fallback-model';
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({
        models: [{ name: 'chat-model', capabilities: ['completion', 'thinking'] }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Fallback visual details' }] } }],
    }), { status: 200 });
  };

  try {
    const result = await generateVisionAnalysis({
      prompt: 'Describe it',
      images: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
    });
    assert.equal(result, 'Fallback visual details');
    assert.equal(calls.some((url) => url.includes('googleapis.com')), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalOllamaUrl;
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

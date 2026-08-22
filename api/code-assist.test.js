import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST,
  prepareDeepSeekTools,
  requestDeepSeekChat,
  selectAssistModel,
  selectEmbeddingModel,
} from './code-assist.js';

test('aliases dotted MIRA tool names for DeepSeek and restores them in tool calls', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const requests = [];
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: {
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'weather__lookup', arguments: '{"city":"Delhi"}' },
        }],
      } }],
    }), { status: 200 });
  };
  try {
    const prepared = prepareDeepSeekTools([{
      type: 'function',
      function: { name: 'weather.lookup', parameters: { type: 'object' } },
    }]);
    assert.equal(prepared.tools[0].function.name, 'weather__lookup');
    const result = await requestDeepSeekChat({
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [{ type: 'function', function: { name: 'weather.lookup', parameters: { type: 'object' } } }],
      think: false,
    });
    const body = JSON.parse(requests[0].options.body);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.tools[0].function.name, 'weather__lookup');
    assert.equal(result.toolCalls[0].function.name, 'weather.lookup');
    assert.deepEqual(result.toolCalls[0].function.arguments, { city: 'Delhi' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('selects a fast coding-capable Pollinations model dynamically', () => {
  assert.equal(selectAssistModel([
    { name: 'general', description: 'General chat', output_modalities: ['text'] },
    { name: 'quick-code', description: 'Fast affordable coding assistant', output_modalities: ['text'], tools: true },
  ]), 'quick-code');
});

test('prefers a Qwen coder model for managed coding tasks', () => {
  assert.equal(selectAssistModel([
    { name: 'general-fast', description: 'Fast affordable coding assistant', output_modalities: ['text'] },
    { name: 'qwen-coder', description: 'Code completion model', output_modalities: ['text'] },
  ]), 'qwen-coder');
});

test('prefers the Qwen semantic embedding model for code retrieval', () => {
  assert.equal(selectEmbeddingModel([
    { name: 'openai-3-small', description: 'Fast text embeddings' },
    { name: 'qwen3-embedding-8b', description: 'Semantic retrieval embeddings' },
  ]), 'qwen3-embedding-8b');
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

test('creates server-side workspace embeddings without exposing credentials', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/embeddings/models')) {
      return new Response(JSON.stringify([{ name: 'qwen3-embedding-8b' }]), { status: 200 });
    }
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: Array(384).fill(index + 0.1) })) }), { status: 200 });
  };
  try {
    const response = await POST(new Request('http://localhost/api/code-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'embedding', input: ['one', 'two'] }),
    }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.embeddings.length, 2);
    assert.equal(payload.model, 'qwen3-embedding-8b');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('routes desktop coding sessions through the server-side DeepSeek credential', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_DESKTOP_MODEL;
  const requests = [];
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  process.env.DEEPSEEK_DESKTOP_MODEL = 'deepseek-v4-pro';
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Implemented and verified.' } }],
    }), { status: 200 });
  };
  try {
    const response = await POST(new Request('http://localhost/api/code-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MIRA-Desktop': '1' },
      body: JSON.stringify({
        task: 'chat',
        systemPrompt: 'You are MIRA, a coding agent.',
        messages: [{ role: 'user', content: 'Fix the failing test.' }],
      }),
    }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.answer, 'Implemented and verified.');
    assert.equal(payload.model, 'deepseek-v4-pro');
    assert.match(requests[0].url, /api\.deepseek\.com\/chat\/completions$/);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer deepseek-server-secret');
    assert.doesNotMatch(requests[0].options.body, /deepseek-server-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_DESKTOP_MODEL;
    else process.env.DEEPSEEK_DESKTOP_MODEL = originalModel;
  }
});

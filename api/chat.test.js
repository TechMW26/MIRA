import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpstreamPayload,
  getContextTokens,
  getUpstreamConnectTimeoutMs,
  getUpstreamStartTimeoutMs,
  managedFallbackResponse,
  POST,
  sanitizeTools,
  selectRegistryModel,
} from './chat.js';

test('returns a stream-compatible managed response when the model server is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.POLLINATIONS_API_KEY;
  process.env.POLLINATIONS_API_KEY = 'server-secret';
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/text/models')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Recovered answer.' } }] }), { status: 200 });
  };
  try {
    const response = await managedFallbackResponse({
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', function: { name: 'not.allowed', parameters: { type: 'object' } } }],
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-recovery'), 'managed');
    assert.deepEqual(JSON.parse((await response.text()).trim()), {
      message: { content: 'Recovered answer.' },
      done: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  }
});

test('prefers a thinking-capable non-vision model for chat', () => {
  const selected = selectRegistryModel([
    { name: 'embedding-only', capabilities: ['embedding'] },
    { name: 'vision-model', capabilities: ['completion', 'vision'] },
    { name: 'runtime-model', capabilities: ['completion', 'tools', 'thinking'] },
  ]);
  assert.deepEqual(selected, {
    name: 'runtime-model',
    capabilities: ['completion', 'tools', 'thinking'],
  });
});

test('returns no selection when the registry has no completion model', () => {
  assert.equal(selectRegistryModel([{ name: 'embedding-only', capabilities: ['embedding'] }]), null);
  assert.equal(selectRegistryModel([]), null);
});

test('allows a hidden environment preference for testing any completion model', () => {
  const selected = selectRegistryModel([
    { name: 'primary', capabilities: ['completion', 'thinking'] },
    { name: 'experimental', capabilities: ['completion'] },
  ], 'experimental');
  assert.equal(selected.name, 'experimental');
  assert.equal(selectRegistryModel([
    { name: 'primary', capabilities: ['completion'] },
    { name: 'vision-only', capabilities: ['vision'] },
  ], 'vision-only').name, 'primary');
});

test('bounds the upstream model-start timeout below the browser timeout', () => {
  assert.equal(getUpstreamStartTimeoutMs(), 50000);
  assert.equal(getUpstreamStartTimeoutMs(1000), 15000);
  assert.equal(getUpstreamStartTimeoutMs(90000), 55000);
});

test('fails over quickly when an upstream connection stalls', () => {
  assert.equal(getUpstreamConnectTimeoutMs(), 8000);
  assert.equal(getUpstreamConnectTimeoutMs(1000), 3000);
  assert.equal(getUpstreamConnectTimeoutMs(90000), 20000);
});

test('uses a concurrency-friendly default while allowing any configured context', () => {
  assert.equal(getContextTokens(), 16384);
  assert.equal(getContextTokens(0), 16384);
  assert.equal(getContextTokens(1000), 1000);
  assert.equal(getContextTokens(100000), 100000);
});

test('builds one streaming Ollama payload from the registry selection', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: ['completion', 'thinking'] },
    messages: [{ role: 'user', content: 'Hello' }],
    think: true,
    maxTokens: 500,
  });
  assert.equal(payload.model, 'runtime-model');
  assert.equal(payload.stream, true);
  assert.equal(payload.think, true);
  assert.equal(payload.keep_alive, -1);
  assert.equal(payload.options.num_predict, 500);
  assert.equal(payload.options.num_ctx, 16384);
  assert.equal(payload.options.repeat_penalty, 1.05);
  assert.match(payload.messages[0].content, /You are Mira, an AI assistant by MW FutureTech/i);
  assert.deepEqual(payload.messages.slice(1, 3), [
    { role: 'user', content: 'Quick check before we start: who are you and what runs you?' },
    { role: 'assistant', content: 'I am Mira, an AI assistant built by MW FutureTech (Mushroom World FutureTech). I do not share details about the underlying technology that powers me. I just focus on helping you. What can I help with?' },
  ]);
  assert.ok(payload.messages.some((message) => message.role === 'user' && message.content === 'Hello'));
});

test('enforces the Mira identity while preserving caller instructions', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: ['completion'] },
    messages: [{ role: 'user', content: 'Who are you?' }],
    systemPrompt: 'Answer in one sentence.',
  });
  assert.match(payload.messages[0].content, /You are Mira, an AI assistant by MW FutureTech/i);
  assert.match(payload.messages[0].content, /Answer in one sentence\./);
  assert.doesNotMatch(payload.messages[0].content, /You are Qwen/i);
});

test('uses a prompt-level thinking switch when tags omit native thinking support', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: [] },
    messages: [{ role: 'user', content: 'Hello' }],
    systemPrompt: 'You are Mira.',
    think: false,
  });
  assert.equal(payload.think, undefined);
  assert.equal(payload.messages.at(-1).content, '/no_think\nHello');
  assert.equal(payload.messages.some((message) => message.content.startsWith('Quick check before we start')), true);
});

test('keeps raw images out of the general chat payload', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: ['completion', 'vision'] },
    messages: [{ role: 'user', content: 'Describe this' }],
    images: [{ base64: 'data:image/png;base64,abc123' }],
  });
  assert.equal(payload.model, 'runtime-model');
  assert.equal(payload.messages.some((message) => message.images?.length), false);
});

test('rejects raw images on the general chat endpoint', async () => {
  const response = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Describe this' }],
      images: [{ base64: 'YWJj', mimeType: 'image/png' }],
    }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only by \/api\/analyze/i);
});

test('forwards only supported native tools to capable registry models', () => {
  const tools = [
    { type: 'function', function: { name: 'web.search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
    { type: 'function', function: { name: 'container.exec', parameters: { type: 'object' } } },
  ];
  assert.equal(sanitizeTools(tools).length, 1);
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: ['completion', 'tools'] },
    messages: [{ role: 'user', content: 'Latest price?' }],
    tools,
  });
  assert.deepEqual(payload.tools.map((tool) => tool.function.name), ['web.search']);
});

test('forwards allowlisted tools when Ollama tags omit tool capability metadata', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'coder-model', capabilities: ['completion'] },
    messages: [{ role: 'user', content: 'Check the weather.' }],
    tools: [{ type: 'function', function: { name: 'weather.lookup', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
  });
  assert.deepEqual(payload.tools.map((tool) => tool.function.name), ['weather.lookup']);
});

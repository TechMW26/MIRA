import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamPayload, POST, sanitizeTools, selectRegistryModel } from './chat.js';

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
  assert.equal(payload.keep_alive, '30m');
  assert.equal(payload.options.num_predict, 500);
  assert.equal(payload.options.repeat_penalty, 1.05);
  assert.ok(payload.messages.some((message) => message.role === 'user' && message.content === 'Hello'));
});

test('forwards disabled thinking even when tags omit model capabilities', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: [] },
    messages: [{ role: 'user', content: 'Hello' }],
    systemPrompt: 'You are Mira.',
    think: false,
  });
  assert.equal(payload.think, false);
  assert.equal(payload.messages.some((message) => message.content.startsWith('Quick check before we start')), false);
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

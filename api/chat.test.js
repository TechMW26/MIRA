import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamPayload, sanitizeTools, selectRegistryModel } from './chat.js';

test('selects the first completion-capable model returned by the registry', () => {
  const selected = selectRegistryModel([
    { name: 'embedding-only', capabilities: ['embedding'] },
    { name: 'runtime-model', capabilities: ['completion', 'vision', 'thinking'] },
    { name: 'later-model', capabilities: ['completion'] },
  ]);
  assert.deepEqual(selected, {
    name: 'runtime-model',
    capabilities: ['completion', 'vision', 'thinking'],
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
  assert.equal(payload.options.num_predict, 500);
  assert.ok(payload.messages.some((message) => message.role === 'user' && message.content === 'Hello'));
});

test('attaches images to the latest user turn without switching models', () => {
  const payload = buildUpstreamPayload({
    registryModel: { name: 'runtime-model', capabilities: ['completion', 'vision'] },
    messages: [{ role: 'user', content: 'Describe this' }],
    images: [{ base64: 'data:image/png;base64,abc123' }],
  });
  assert.equal(payload.model, 'runtime-model');
  assert.deepEqual(payload.messages.at(-1).images, ['abc123']);
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

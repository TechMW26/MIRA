import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  prepareDeepSeekTools,
  requestDeepSeekChat,
  requestDeepSeekCompletion,
} = require('../../desktop/aiProviders.cjs');

test('maps dotted desktop tool names to provider-safe aliases and restores them', async () => {
  const requests = [];
  const result = await requestDeepSeekChat({
    apiKey: 'secret',
    messages: [{ role: 'user', content: 'Inspect the workspace' }],
    tools: [{
      type: 'function',
      function: {
        name: 'filesystem.read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }],
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        model: 'deepseek-v4-pro',
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'filesystem__read', arguments: '{"path":"src/a.js"}' } }],
        } }],
      }), { status: 200 });
    },
  });

  assert.equal(requests[0].tools[0].function.name, 'filesystem__read');
  assert.equal(result.toolCalls[0].function.name, 'filesystem.read');
  assert.deepEqual(result.toolCalls[0].function.arguments, { path: 'src/a.js' });
});

test('keeps tool aliases unique and within provider naming rules', () => {
  const prepared = prepareDeepSeekTools([
    { type: 'function', function: { name: 'git.status', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'git__status', parameters: { type: 'object' } } },
  ]);
  const names = prepared.tools.map((tool) => tool.function.name);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name)));
});

test('uses the DeepSeek FIM endpoint for desktop code completion', async () => {
  let request;
  const suggestion = await requestDeepSeekCompletion({
    apiKey: 'secret',
    prefix: 'function add(a, b) {',
    suffix: '}',
    fetchImpl: async (url, options) => {
      request = { url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization };
      return new Response(JSON.stringify({ choices: [{ text: '\n  return a + b;\n' }] }), { status: 200 });
    },
  });
  assert.match(request.url, /\/beta\/completions$/);
  assert.equal(request.authorization, 'Bearer secret');
  assert.equal(request.body.suffix, '}');
  assert.equal(suggestion, '\n  return a + b;');
});

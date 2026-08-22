import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpstreamPayload,
  deepSeekChatResponse,
  getAdaptiveContextTokens,
  getContextTokens,
  getUpstreamConnectTimeoutMs,
  getUpstreamStartTimeoutMs,
  managedFallbackResponse,
  POST,
  sanitizeTools,
  selectRegistryModel,
} from './chat.js';

test('returns a stream-compatible DeepSeek response for desktop coding fallback', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({
    model: 'deepseek-v4-flash',
    choices: [{ message: { content: 'Fast answer.' } }],
  }), { status: 200 });
  try {
    const response = await deepSeekChatResponse({
      messages: [{ role: 'user', content: 'Hello' }],
      think: false,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'deepseek');
    assert.deepEqual(JSON.parse((await response.text()).trim()), {
      model: 'deepseek-v4-flash',
      message: { content: 'Fast answer.' },
      done: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

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
  assert.equal(getUpstreamConnectTimeoutMs(), 28000);
  assert.equal(getUpstreamConnectTimeoutMs(1000), 10000);
  assert.equal(getUpstreamConnectTimeoutMs(90000), 50000);
});

test('keeps text chat off the vision model while respecting residency and overrides', () => {
  const models = [
    { name: 'large', size: 18_600_000_000, capabilities: ['completion'] },
    { name: 'small', size: 6_100_000_000, capabilities: ['vision', 'completion', 'tools', 'thinking'] },
  ];
  assert.equal(selectRegistryModel(models).name, 'large');
  assert.equal(selectRegistryModel(models, '', { residentNames: ['large'] }).name, 'large');
  assert.equal(selectRegistryModel(models, 'large').name, 'large');
  assert.equal(selectRegistryModel(models, '', { excludedNames: ['small'] }).name, 'large');
});

test('uses a concurrency-friendly default while allowing any configured context', () => {
  assert.equal(getContextTokens(), 16384);
  assert.equal(getContextTokens(0), 16384);
  assert.equal(getContextTokens(1000), 1000);
  assert.equal(getContextTokens(100000), 100000);
  assert.equal(getAdaptiveContextTokens([{ role: 'user', content: 'Hello' }], 500, 16384), 2048);
  assert.equal(getAdaptiveContextTokens([{ role: 'user', content: 'x'.repeat(30000) }], 1000, 16384), 16384);
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
  assert.equal(payload.options.num_ctx, 2048);
  assert.equal(payload.options.repeat_penalty, 1.05);
  assert.match(payload.messages[0].content, /You are Mira, an AI assistant by MW FutureTech/i);
  assert.deepEqual(payload.messages.slice(1, 3), [
    { role: 'user', content: 'Quick check before we start: who are you and what runs you?' },
    { role: 'assistant', content: 'I am Mira, an AI assistant built by MW FutureTech (Mushroom World FutureTech). I do not share details about the underlying technology that powers me. I just focus on helping you. What can I help with?' },
  ]);
  assert.ok(payload.messages.some((message) => message.role === 'user' && message.content.includes('Hello')));
  assert.equal(payload.messages.at(-1).content, '/think\nHello');
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

test('accepts the desktop screen-context schema for the native companion relay', () => {
  const tools = sanitizeTools([{
    type: 'function',
    function: {
      name: 'desktop.screen_context',
      description: 'Inspect the current desktop screen.',
      parameters: {
        type: 'object',
        properties: { focus: { type: 'string' } },
        required: ['focus'],
      },
    },
  }]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].function.name, 'desktop.screen_context');
});

test('fails over to another registry model when the preferred upstream is unhealthy', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.OLLAMA_API_URL;
  process.env.OLLAMA_API_URL = 'http://ollama.test:11434/api/chat';
  const attempted = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [
        { name: 'large', size: 18_600_000_000, capabilities: ['completion'] },
        { name: 'small', size: 6_100_000_000, capabilities: ['completion', 'tools', 'thinking'] },
      ] }), { status: 200 });
    }
    if (target.endsWith('/api/ps')) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    const payload = JSON.parse(options.body || '{}');
    attempted.push(payload.model);
    if (payload.model === 'small') {
      return new Response(JSON.stringify({ error: 'load failed' }), { status: 503 });
    }
    return new Response(`${JSON.stringify({ message: { content: 'Recovered on alternate model.' }, done: true })}\n`, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  };

  try {
    const freshModule = await import(`./chat.js?model-failover=${Date.now()}`);
    const response = await freshModule.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], think: false }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-model-failover'), '1');
    assert.deepEqual(attempted, ['small', 'large']);
    assert.match(await response.text(), /Recovered on alternate model/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalUrl;
  }
});

test('routes web task workflows only through Ollama even when desktop provider keys exist', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.OLLAMA_API_URL;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const originalPollinationsKey = process.env.POLLINATIONS_API_KEY;
  process.env.OLLAMA_API_URL = 'http://ollama-web.test:11434/api/chat';
  process.env.DEEPSEEK_API_KEY = 'desktop-only-deepseek-key';
  process.env.POLLINATIONS_API_KEY = 'desktop-only-pollinations-key';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    requestedUrls.push(target);
    if (target.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [
        { name: 'web-model', capabilities: ['completion', 'thinking'] },
      ] }), { status: 200 });
    }
    if (target.endsWith('/api/ps')) {
      return new Response(JSON.stringify({ models: [{ name: 'web-model' }] }), { status: 200 });
    }
    if (target === 'http://ollama-web.test:11434/api/chat') {
      return new Response(`${JSON.stringify({ message: { content: 'Ollama task result.' }, done: true })}\n`, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }
    throw new Error(`Unexpected provider request: ${target}`);
  };

  try {
    const freshModule = await import(`./chat.js?web-ollama-only=${Date.now()}`);
    const response = await freshModule.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': 'web-task-routing-test' },
      body: JSON.stringify({
        requestClass: 'task',
        messages: [{ role: 'user', content: 'Execute a task step.' }],
        think: true,
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'ollama');
    assert.match(await response.text(), /Ollama task result/);
    assert.equal(requestedUrls.some((url) => /deepseek|pollinations/i.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalUrl;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    if (originalPollinationsKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalPollinationsKey;
  }
});

test('does not quarantine Ollama models across independent requests after transient 503s', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.OLLAMA_API_URL;
  process.env.OLLAMA_API_URL = 'http://ollama-recovery.test:11434/api/chat';
  let chatAttempts = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [
        { name: 'primary', size: 6_000_000_000, capabilities: ['completion', 'thinking'] },
        { name: 'secondary', size: 8_000_000_000, capabilities: ['completion'] },
      ] }), { status: 200 });
    }
    if (target.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [] }), { status: 200 });
    chatAttempts += 1;
    if (chatAttempts <= 2) return new Response(JSON.stringify({ error: 'temporary load failure' }), { status: 503 });
    return new Response(`${JSON.stringify({ message: { content: 'Recovered on the next task attempt.' }, done: true })}\n`, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  };

  try {
    const freshModule = await import(`./chat.js?cross-request-recovery=${Date.now()}`);
    const makeRequest = (suffix) => new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': `ollama-recovery-${suffix}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Run this step.' }], requestClass: 'task' }),
    });
    const failed = await freshModule.POST(makeRequest('first'));
    assert.equal(failed.status, 503);
    const recovered = await freshModule.POST(makeRequest('second'));
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get('x-mira-provider'), 'ollama');
    assert.match(await recovered.text(), /Recovered on the next task attempt/);
    assert.equal(chatAttempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = originalUrl;
  }
});

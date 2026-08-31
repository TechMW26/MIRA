import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deepSeekChatResponse,
  managedFallbackResponse,
  miraChatResponse,
  POST,
  sanitizeTools,
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

test('proxies the streaming MIRA response from the primary provider', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const originalKey = process.env.MIRA_API_TOKEN;
  const originalModel = process.env.MIRA_CHAT_MODEL;
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira.example.test/v1';
  process.env.MIRA_API_TOKEN = 'mira-server-secret';
  process.env.MIRA_CHAT_MODEL = 'MIRA:latest';
  const sseBody = 'data: {"choices":[{"delta":{"content":"Hello from MIRA."}}]}\n\ndata: [DONE]\n\n';
  let captured;
  globalThis.fetch = async (url, options = {}) => {
    captured = {
      url: String(url),
      authorization: options.headers?.Authorization,
      body: JSON.parse(options.body || '{}'),
    };
    return new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const freshModule = await import(`./chat.js?mira-primary=${Date.now()}`);
    const response = await freshModule.miraChatResponse({
      messages: [{ role: 'user', content: 'Hello MIRA' }],
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'mira');
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(await response.text(), sseBody);
    assert.equal(captured.url, 'https://mira.example.test/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer mira-server-secret');
    assert.equal(captured.body.model, 'MIRA:latest');
    assert.equal(captured.body.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = originalBaseUrl;
    if (originalKey === undefined) delete process.env.MIRA_API_TOKEN;
    else process.env.MIRA_API_TOKEN = originalKey;
    if (originalModel === undefined) delete process.env.MIRA_CHAT_MODEL;
    else process.env.MIRA_CHAT_MODEL = originalModel;
  }
});

test('routes web chat through the MIRA primary provider when configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const originalKey = process.env.MIRA_API_TOKEN;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira-primary.test/v1';
  process.env.MIRA_API_TOKEN = 'mira-server-secret';
  process.env.DEEPSEEK_API_KEY = 'web-fallback-key';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    requestedUrls.push(target);
    if (target === 'https://mira-primary.test/v1/chat/completions') {
      return new Response(JSON.stringify({
        model: 'MIRA:latest',
        choices: [{ message: { content: 'Primary MIRA answer.' } }],
      }), { status: 200 });
    }
    throw new Error(`Unexpected provider request: ${target}`);
  };
  try {
    const freshModule = await import(`./chat.js?mira-primary-route=${Date.now()}`);
    const response = await freshModule.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello MIRA' }] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'mira');
    assert.match(await response.text(), /Primary MIRA answer/);
    assert.equal(requestedUrls.some((url) => /deepseek/i.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = originalBaseUrl;
    if (originalKey === undefined) delete process.env.MIRA_API_TOKEN;
    else process.env.MIRA_API_TOKEN = originalKey;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  }
});

test('falls back to DeepSeek Flash when the MIRA primary provider fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const originalKey = process.env.MIRA_API_TOKEN;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira-down.test/v1';
  process.env.MIRA_API_TOKEN = 'mira-server-secret';
  process.env.DEEPSEEK_API_KEY = 'web-fallback-key';
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === 'https://mira-down.test/v1/chat/completions') {
      return new Response(JSON.stringify({ error: 'model loading' }), { status: 503 });
    }
    if (target === 'https://api.deepseek.com/chat/completions') {
      return new Response(JSON.stringify({
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'DeepSeek recovered.' } }],
      }), { status: 200 });
    }
    throw new Error(`Unexpected provider request: ${target}`);
  };
  try {
    const freshModule = await import(`./chat.js?mira-deepseek-fallback=${Date.now()}`);
    const response = await freshModule.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'deepseek');
    assert.equal(response.headers.get('x-mira-recovery'), 'mira-unavailable');
    assert.match(await response.text(), /DeepSeek recovered/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = originalBaseUrl;
    if (originalKey === undefined) delete process.env.MIRA_API_TOKEN;
    else process.env.MIRA_API_TOKEN = originalKey;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  }
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

test('returns a retryable outage when both web providers are unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.MIRA_OPENAI_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const freshModule = await import(`./chat.js?all-unavailable=${Date.now()}`);
    const response = await freshModule.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'The chat service is temporarily unavailable. Please try again shortly.',
      code: 'chat_service_unavailable',
      retryable: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = originalBaseUrl;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  }
});

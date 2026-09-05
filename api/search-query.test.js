import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery } from './_searchQuery.js';
import { POST } from './search-query.js';

function plannerRequest(body, ip) {
  return new Request('https://www.itsmira.cloud/api/search-query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.itsmira.cloud',
      'X-Real-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

function saveProviderEnv() {
  return {
    miraOpenAiBaseUrl: process.env.MIRA_OPENAI_BASE_URL,
    miraBaseUrl: process.env.MIRA_BASE_URL,
    miraApiToken: process.env.MIRA_API_TOKEN,
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
  };
}

function restoreProviderEnv(original) {
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('MIRA_OPENAI_BASE_URL', original.miraOpenAiBaseUrl);
  restore('MIRA_BASE_URL', original.miraBaseUrl);
  restore('MIRA_API_TOKEN', original.miraApiToken);
  restore('DEEPSEEK_API_KEY', original.deepSeekApiKey);
}

test('forms fallback queries from the latest user message only', () => {
  assert.equal(fallbackSearchQuery('Do you know about algaetree?'), 'algaetree');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.'), 'Project Zephyr');
  assert.equal(fallbackSearchQuery('Okay can you let me know what an algae tree is?'), 'algae tree');
});

test('uses conversation context only to resolve a referential follow-up', () => {
  const context = 'Model search hint: AlgaeTree\nEarlier user message: Tell me about AlgaeTree';
  assert.equal(fallbackSearchQuery('What does it do?', context), 'AlgaeTree purpose function');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.', context), 'Project Zephyr');
  assert.equal(
    fallbackSearchQuery('Do some deep research on their market', 'Recent subject anchor: Manor Lords'),
    'Manor Lords deep research market',
  );
});

test('uses MIRA to resolve the latest message into a contextual search query', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = saveProviderEnv();
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira-query.test/v1';
  process.env.MIRA_API_TOKEN = 'mira-server-secret';
  process.env.DEEPSEEK_API_KEY = 'deepseek-fallback-secret';
  let upstreamBody;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://mira-query.test/v1/chat/completions');
    upstreamBody = JSON.parse(options.body);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Ankita Pandey Lucknow"}}]}',
      'data: {"choices":[{"delta":{"content":" content creator"}}]}',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const response = await POST(plannerRequest({
      latestMessage: 'Check the web she is a content creator',
      context: 'Recent subject anchor: Ankita Pandey Lucknow',
    }, 'search-query-mira-test'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Ankita Pandey Lucknow content creator',
      source: 'mira',
    });
    assert.equal(upstreamBody.model, 'MIRA:latest');
    assert.equal(upstreamBody.stream, true);
    assert.match(upstreamBody.messages.at(-1).content, /Ankita Pandey Lucknow/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnv(originalEnv);
  }
});

test('uses DeepSeek only after two retryable MIRA planner failures', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = saveProviderEnv();
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira-query-down.test/v1';
  process.env.MIRA_API_TOKEN = 'mira-server-secret';
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  let miraAttempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://mira-query-down.test/v1/chat/completions') {
      miraAttempts += 1;
      return Response.json({ error: 'busy' }, { status: 503 });
    }
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      return Response.json({
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'Project Zephyr product overview' } }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await POST(plannerRequest({
      latestMessage: 'Tell me about Project Zephyr.',
    }, 'search-query-outage-test'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Project Zephyr product overview',
      source: 'deepseek-fallback',
    });
    assert.equal(miraAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnv(originalEnv);
  }
});

test('does not hide MIRA planner authentication failures behind DeepSeek', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = saveProviderEnv();
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira-query-auth.test/v1';
  process.env.MIRA_API_TOKEN = 'invalid-mira-secret';
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return Response.json({ error: 'invalid token' }, { status: 401 });
  };
  try {
    const response = await POST(plannerRequest({
      latestMessage: 'Tell me about Project Zephyr.',
    }, 'search-query-auth-test'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Project Zephyr',
      source: 'deterministic-fallback',
    });
    assert.deepEqual(requestedUrls, ['https://mira-query-auth.test/v1/chat/completions']);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnv(originalEnv);
  }
});

test('falls back deterministically when MIRA query planning is not configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = saveProviderEnv();
  delete process.env.MIRA_OPENAI_BASE_URL;
  delete process.env.MIRA_BASE_URL;
  delete process.env.MIRA_API_TOKEN;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('No provider should be called');
  };
  try {
    const response = await POST(plannerRequest({
      latestMessage: 'Tell me about Project Zephyr.',
    }, 'search-query-unconfigured-test'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Project Zephyr',
      source: 'deterministic-fallback',
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProviderEnv(originalEnv);
  }
});

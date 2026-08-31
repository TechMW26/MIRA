import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery } from './_searchQuery.js';
import { POST } from './search-query.js';

test('forms fallback queries from the latest user message only', () => {
  assert.equal(fallbackSearchQuery('Do you know about algaetree?'), 'algaetree');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.'), 'Project Zephyr');
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

test('uses DeepSeek to resolve the latest message into a contextual search query', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  let upstreamBody;
  globalThis.fetch = async (_url, options = {}) => {
    upstreamBody = JSON.parse(options.body);
    return Response.json({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'Ankita Pandey Lucknow content creator' } }],
    });
  };
  try {
    const response = await POST(new Request('https://www.itsmira.cloud/api/search-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.itsmira.cloud',
        'X-Real-IP': 'search-query-ai-test',
      },
      body: JSON.stringify({
        latestMessage: 'Check the web she is a content creator',
        context: 'Recent subject anchor: Ankita Pandey Lucknow',
      }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Ankita Pandey Lucknow content creator',
      source: 'deepseek',
    });
    assert.equal(upstreamBody.model, 'deepseek-v4-flash');
    assert.match(upstreamBody.messages.at(-1).content, /Ankita Pandey Lucknow/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('falls back deterministically when the AI query planner is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  globalThis.fetch = async () => { throw new Error('planner offline'); };
  try {
    const response = await POST(new Request('https://www.itsmira.cloud/api/search-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.itsmira.cloud',
        'X-Real-IP': 'search-query-fallback-test',
      },
      body: JSON.stringify({ latestMessage: 'Tell me about Project Zephyr.' }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'Project Zephyr',
      source: 'deterministic-fallback',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

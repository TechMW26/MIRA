import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery, formSearchQuery, modelSearchQuery } from './searchQuery.js';

test('uses the AI query planner and sends it conversation context', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json({ query: 'Ankita Pandey Lucknow content creator', source: 'deepseek' });
  };
  try {
    assert.equal(await formSearchQuery({
      latestMessage: 'Check the web she is a content creator',
      context: 'Recent subject anchor: Ankita Pandey Lucknow',
    }), 'Ankita Pandey Lucknow content creator');
    assert.equal(requestBody.latestMessage, 'Check the web she is a content creator');
    assert.match(requestBody.context, /Ankita Pandey Lucknow/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps deterministic query formation only as an outage fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('planner offline'); };
  try {
    assert.equal(await formSearchQuery({ latestMessage: 'What is an algae tree?' }), 'algae tree');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fallbackSearchQuery('Please tell me about MIRA AI'), 'MIRA AI');
  assert.equal(fallbackSearchQuery('Can you help me with better understanding of canact'), 'canact');
});

test('uses conversation context for referential follow-ups', async () => {
  assert.equal(fallbackSearchQuery('What does it do?', 'Image-derived searchable entity: AlgaeTree'), 'AlgaeTree purpose function');
  assert.equal(fallbackSearchQuery(
    'Okay, can you do some extensive market analysis for the same please?',
    'Recent subject anchor: Canact\nMIRA: Here are ideas for the Canact stack.',
  ), 'Canact market analysis');
  assert.equal(fallbackSearchQuery(
    'Do some deep research on their market',
    'Recent subject anchor: Manor Lords\nMIRA: Manor Lords is a city-building game.',
  ), 'Manor Lords deep research market');
});

test('cleans but does not reinterpret a model-provided tool query', () => {
  assert.equal(
    modelSearchQuery('  "Ankita Pandey Lucknow content creator"  '),
    'Ankita Pandey Lucknow content creator',
  );
});

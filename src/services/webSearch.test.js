import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceFallbackAnswer,
  buildSearchRetryQueries,
  isSearchResultRelevant,
  searchWeb,
} from './webSearch.js';

test('builds simpler fallback queries for empty search results', () => {
  const queries = buildSearchRetryQueries('What is the most expensive yacht in India?');
  assert.equal(queries[0], 'most expensive yacht in India');
  assert.ok(queries.includes('What is the most expensive yacht in India?'));
  assert.ok(queries.includes('most expensive yacht in India'));
  assert.ok(queries.includes('"most expensive yacht" India'));
  assert.ok(queries.includes('India most expensive yacht'));
});

test('adds the current year for freshness retries', () => {
  const queries = buildSearchRetryQueries('latest yacht price India', true);
  assert.ok(queries.some((query) => query.includes(String(new Date().getUTCFullYear()))));
});

test('normalizes conversational shorthand and common search typos', () => {
  const queries = buildSearchRetryQueries('most expensive yatch in india rn', true);
  assert.ok(queries.includes('most expensive yacht in india right now'));
});

test('preserves coined and brand-like compounds for AI query formation', () => {
  assert.equal(buildSearchRetryQueries('algaetree')[0], 'algaetree');
});

test('extracts and expands a coined entity from a conversational question', () => {
  const queries = buildSearchRetryQueries('What do you know about the AlgaeTree?');
  assert.equal(queries[0], 'AlgaeTree');
  assert.ok(queries.includes('Algae Tree'));
  assert.ok(queries.includes('"AlgaeTree"'));
});

test('extracts the subject from a Hinglish research question', () => {
  const queries = buildSearchRetryQueries('Mujhe algaetree ke baare mein current verified details batao.');
  assert.ok(queries.includes('algaetree'));
});

test('builds a readable evidence answer when model regeneration fails', () => {
  const answer = buildEvidenceFallbackAnswer({
    results: [{
      title: 'Bhopal installs an algae tree',
      snippet: 'The installation uses microalgae to absorb carbon dioxide.',
      publishedAt: '2026-05-11',
      url: 'https://example.com/algae-tree',
    }],
  }, 'algae tree');
  assert.match(answer, /live search found/i);
  assert.match(answer, /Bhopal installs an algae tree/);
  assert.match(answer, /\[Bhopal installs an algae tree\]\(https:\/\/example\.com\/algae-tree\)/);
});

test('retries transient failures before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
    }
    return new Response(JSON.stringify({
      results: [{ title: 'Test query recovered', snippet: 'ok', url: 'https://example.com' }],
      media: { videos: [], images: [] },
    }), { status: 200 });
  };

  try {
    const result = await searchWeb({ query: 'test query', includeMedia: false });
    assert.equal(calls, 2);
    assert.equal(result.results[0].title, 'Test query recovered');
    assert.equal(result.searchMeta.recovered, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries an empty response with a simplified query', async () => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);
    const found = body.query === 'India most expensive yacht';
    return new Response(JSON.stringify({
      results: found ? [{
        title: "India's most expensive yacht",
        snippet: 'A report about the most expensive yacht in India.',
        url: 'https://example.com/yacht',
      }] : [],
      media: { videos: [], images: [] },
    }), { status: 200 });
  };

  try {
    const result = await searchWeb({
      query: 'most expensive yacht in India',
      includeMedia: false,
    }, { attemptsPerQuery: 1 });
    assert.ok(queries.includes('India most expensive yacht'));
    assert.equal(result.results[0].title, "India's most expensive yacht");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects filler-word hits and accepts the searched coined entity', () => {
  assert.equal(isSearchResultRelevant({
    results: [{
      title: 'How do trees grow?',
      snippet: 'Everything you need to know about ordinary trees.',
      url: 'https://example.com/generic-tree',
    }],
  }, 'What do you know about the AlgaeTree?'), false);

  assert.equal(isSearchResultRelevant({
    results: [{
      title: 'Bhopal installs an Algae Tree',
      snippet: 'The AlgaeTree installation uses microalgae to capture carbon dioxide.',
      url: 'https://example.com/algae-tree',
    }],
  }, 'What do you know about the AlgaeTree?'), true);
});

test('rejects generic results that do not match the searched subject', () => {
  const genericIndiaResults = {
    results: [{
      title: 'India country profile',
      snippet: 'General information about geography and trade in India.',
      url: 'https://example.com/india',
    }],
  };
  assert.equal(
    isSearchResultRelevant(genericIndiaResults, 'most expensive yacht in India'),
    false,
  );
});

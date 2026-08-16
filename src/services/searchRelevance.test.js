import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSearchSubject,
  fuseSearchProviders,
  rankSearchResults,
} from './searchRelevance.js';

test('extracts the entity instead of conversational filler', () => {
  assert.equal(extractSearchSubject('What do you know about the AlgaeTree?'), 'AlgaeTree');
});

test('keeps relevant URL-backed results and drops generic filler matches', () => {
  const ranked = rankSearchResults([
    {
      title: 'Everything you need to know about trees',
      snippet: 'A general gardening guide.',
      url: 'https://example.com/trees',
    },
    {
      title: 'India installs its first Algae Tree',
      snippet: 'The AlgaeTree uses microalgae to capture carbon dioxide.',
      url: 'https://example.com/algae-tree',
    },
  ], 'What do you know about the AlgaeTree?');

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, 'India installs its first Algae Tree');
});

test('fuses providers, ranks exact evidence first, and removes tracking duplicates', () => {
  const fused = fuseSearchProviders([
    {
      provider: 'brave',
      weight: 3,
      results: [{
        title: 'AlgaeTree captures urban carbon',
        snippet: 'An Algae Tree uses microalgae in an urban installation.',
        url: 'https://news.example/algae-tree?utm_source=search',
      }],
    },
    {
      provider: 'google',
      weight: 3,
      results: [{
        title: 'AlgaeTree captures urban carbon',
        snippet: 'The same AlgaeTree report.',
        url: 'https://news.example/algae-tree?utm_medium=web',
      }],
    },
    {
      provider: 'bing-web',
      weight: 1,
      results: [{
        title: 'Tree care guide',
        snippet: 'What to know about trees.',
        url: 'https://example.com/tree-care',
      }],
    },
  ], 'AlgaeTree');

  assert.equal(fused.length, 1);
  assert.equal(fused[0].provider, 'brave');
});

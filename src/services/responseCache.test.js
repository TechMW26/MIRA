import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCacheKey } from './responseCache.js';

test('does not cache responses grounded in live web-search data', () => {
  const key = makeCacheKey({
    model: 'mira-lite',
    messages: [{
      role: 'user',
      content: 'Question\n\n=== REAL-TIME WEB SEARCH DATA ===\n[1] Current source',
    }],
  });
  assert.equal(key, null);
});

test('still caches ordinary text-only requests', () => {
  const key = makeCacheKey({
    model: 'mira-lite',
    messages: [{ role: 'user', content: 'Explain recursion' }],
  });
  assert.equal(typeof key, 'string');
});

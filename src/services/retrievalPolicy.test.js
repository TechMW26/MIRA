import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRetrievalPolicy } from './retrievalPolicy.js';

test('searches current facts without paying for unrelated media', () => {
  assert.deepEqual(decideRetrievalPolicy({ engineNeedsSearch: true }), {
    search: true,
    includeMedia: false,
  });
});

test('fetches media only for explicit or image-grounded media needs', () => {
  assert.deepEqual(decideRetrievalPolicy({ mediaRequested: true }), {
    search: true,
    includeMedia: true,
  });
  assert.deepEqual(decideRetrievalPolicy({ visualSearch: true }), {
    search: true,
    includeMedia: true,
  });
});

test('website inspection and greetings bypass generic retrieval', () => {
  assert.deepEqual(decideRetrievalPolicy({ websiteInspection: true, manualSearch: true }), {
    search: false,
    includeMedia: false,
  });
  assert.deepEqual(decideRetrievalPolicy({ simpleGreeting: true, engineNeedsSearch: true }), {
    search: false,
    includeMedia: false,
  });
});

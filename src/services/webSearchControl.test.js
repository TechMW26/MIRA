import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWebSearchRequest,
  isPotentialWebSearchControl,
  stripWebSearchControl,
  thinkingSuggestsWebSearch,
} from './webSearchControl.js';

test('extracts and cleans a web-search control marker', () => {
  assert.deepEqual(
    extractWebSearchRequest('[WEB_SEARCH:  latest MIRA release notes  ]'),
    { query: 'latest MIRA release notes', source: 'marker' },
  );
});

test('strips complete and partial control markers from visible output', () => {
  assert.equal(stripWebSearchControl('[WEB_SEARCH: current weather Mumbai]'), '');
  assert.equal(stripWebSearchControl('Checking.\n[WEB_SEARCH: latest result]'), 'Checking.');
  assert.equal(stripWebSearchControl('[WEB_SEARCH: latest res'), '');
});

test('detects control output and search-worthy reasoning language', () => {
  assert.equal(isPotentialWebSearchControl('[WEB_SEARCH:'), true);
  assert.equal(thinkingSuggestsWebSearch('I should verify the latest release online.'), true);
  assert.equal(thinkingSuggestsWebSearch('I can answer this arithmetic problem directly.'), false);
});


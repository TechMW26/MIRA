import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWebSearchRequest,
  isPotentialWebSearchControl,
  stripWebSearchControl,
} from './webSearchControl.js';

test('extracts and cleans a web-search control marker', () => {
  assert.deepEqual(
    extractWebSearchRequest('[WEB_SEARCH:  latest MIRA release notes  ]'),
    { query: 'latest MIRA release notes', source: 'marker' },
  );
  assert.deepEqual(
    extractWebSearchRequest('[MIRA_WEB_SEARCH: current weather Mumbai]'),
    { query: 'current weather Mumbai', source: 'marker' },
  );
});

test('strips complete and partial control markers from visible output', () => {
  assert.equal(stripWebSearchControl('[MIRA_WEB_SEARCH: current weather Mumbai]'), '');
  assert.equal(stripWebSearchControl('Checking.\n[WEB_SEARCH: latest result]'), 'Checking.');
  assert.equal(stripWebSearchControl('[MIRA_WEB_SEARCH: latest res'), '');
});

test('detects only explicit web-search control output', () => {
  assert.equal(isPotentialWebSearchControl('[MIRA_WEB_SEARCH:'), true);
  assert.equal(isPotentialWebSearchControl('I should verify the latest release online.'), false);
});

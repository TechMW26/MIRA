import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnchorScope } from './search.js';

test('expands compact entity anchors before strict result and media matching', () => {
  assert.deepEqual(buildAnchorScope('AlgaeTree'), {
    phrase: 'Algae Tree',
    phraseNorm: 'algae tree',
    terms: ['algae', 'tree'],
  });
});

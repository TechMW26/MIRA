import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery, formSearchQuery } from './searchQuery.js';

test('forms search queries locally without a network round trip', async () => {
  assert.equal(await formSearchQuery({ latestMessage: 'What is an algae tree?' }), 'algae tree');
  assert.equal(fallbackSearchQuery('Please tell me about MIRA AI'), 'MIRA AI');
});

test('uses conversation context for referential follow-ups', async () => {
  assert.equal(await formSearchQuery({
    latestMessage: 'What does it do?',
    context: 'Image-derived searchable entity: AlgaeTree',
  }), 'AlgaeTree purpose function');
});

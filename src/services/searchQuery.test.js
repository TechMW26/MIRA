import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery, formSearchQuery } from './searchQuery.js';

test('forms search queries locally without a network round trip', async () => {
  assert.equal(await formSearchQuery({ latestMessage: 'What is an algae tree?' }), 'algae tree');
  assert.equal(fallbackSearchQuery('Please tell me about MIRA AI'), 'MIRA AI');
  assert.equal(fallbackSearchQuery('Can you help me with better understanding of canact'), 'canact');
});

test('uses conversation context for referential follow-ups', async () => {
  assert.equal(await formSearchQuery({
    latestMessage: 'What does it do?',
    context: 'Image-derived searchable entity: AlgaeTree',
  }), 'AlgaeTree purpose function');
  assert.equal(await formSearchQuery({
    latestMessage: 'Okay, can you do some extensive market analysis for the same please?',
    context: 'Recent subject anchor: Canact\nMIRA: Here are ideas for the Canact stack.',
  }), 'Canact market analysis');
  assert.equal(await formSearchQuery({
    latestMessage: 'Do some deep research on their market',
    context: 'Recent subject anchor: Manor Lords\nMIRA: Manor Lords is a city-building game.',
  }), 'Manor Lords deep research market');
});

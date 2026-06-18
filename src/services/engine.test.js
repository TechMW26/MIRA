import test from 'node:test';
import assert from 'node:assert/strict';
import { processQuery } from './engine.js';

test('keeps evergreen explanations offline', () => {
  assert.equal(processQuery('Explain how gravity works').needsSearch, false);
  assert.equal(processQuery('What does recursion mean?').needsSearch, false);
});

test('routes current, explicit, and high-stakes facts to search', () => {
  assert.equal(processQuery('What is the latest Bitcoin price?').needsSearch, true);
  assert.equal(processQuery('Search the web for MIRA release notes').needsSearch, true);
  assert.equal(processQuery('What are the current visa regulations for India?').needsSearch, true);
});

test('routes sufficiently specific niche topics to search', () => {
  assert.equal(processQuery('Tell me about AlgaeTree BioUrban').needsSearch, true);
});

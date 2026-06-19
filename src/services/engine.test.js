import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFreshInformation, processQuery } from './engine.js';

test('keeps evergreen explanations offline', () => {
  assert.equal(processQuery('Explain how gravity works').needsSearch, false);
  assert.equal(processQuery('What does recursion mean?').needsSearch, false);
});

test('routes current, explicit, and high-stakes facts to search', () => {
  assert.equal(processQuery('What is the latest Bitcoin price?').needsSearch, true);
  assert.equal(processQuery('Search the web for MIRA release notes').needsSearch, true);
  assert.equal(processQuery('What are the current visa regulations for India?').needsSearch, true);
});

test('identifies requests that require newest-first evidence', () => {
  assert.equal(needsFreshInformation('What is the latest release?'), true);
  assert.equal(needsFreshInformation('Explain the release process'), false);
});

test('routes sufficiently specific niche topics to search', () => {
  assert.equal(processQuery('Tell me about AlgaeTree BioUrban').needsSearch, true);
  assert.equal(processQuery('Tell me something about the Algae tree').needsSearch, true);
});

test('auto selects models by task complexity', () => {
  assert.equal(processQuery('Hello there', false, { selectedMode: 'auto' }).model, 'mira-lite');
  assert.equal(processQuery('Build a React component with state and validation', false, { selectedMode: 'auto' }).model, 'mira');
  assert.equal(processQuery('Design an in-depth distributed system architecture step-by-step', false, { selectedMode: 'auto' }).model, 'mira-pro');
});

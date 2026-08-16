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

test('does not expose model-routing metadata', () => {
  assert.equal('model' in processQuery('Hello there'), false);
  assert.equal('model' in processQuery('Build a React component'), false);
});

test('keeps greetings and ordinary conversation out of media generation', () => {
  assert.equal(processQuery('Hey').classification.intent, 'general');
  assert.equal(processQuery('Hello there').interpretation.imageIntent, false);
  assert.equal(processQuery('How are you?').interpretation.videoIntent, false);
  assert.equal(processQuery('Please generate an image of an elephant').interpretation.imageIntent, true);
});

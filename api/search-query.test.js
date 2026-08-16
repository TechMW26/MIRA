import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery } from './_searchQuery.js';

test('forms fallback queries from the latest user message only', () => {
  assert.equal(fallbackSearchQuery('Do you know about algaetree?'), 'algaetree');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.'), 'Project Zephyr');
});

test('uses conversation context only to resolve a referential follow-up', () => {
  const context = 'Model search hint: AlgaeTree\nEarlier user message: Tell me about AlgaeTree';
  assert.equal(fallbackSearchQuery('What does it do?', context), 'AlgaeTree purpose function');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.', context), 'Project Zephyr');
});

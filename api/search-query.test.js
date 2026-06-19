import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchQuery } from './_searchQuery.js';

test('forms fallback queries from the latest user message only', () => {
  assert.equal(fallbackSearchQuery('Do you know about algaetree?'), 'algaetree');
  assert.equal(fallbackSearchQuery('Tell me about Project Zephyr.'), 'Project Zephyr');
});

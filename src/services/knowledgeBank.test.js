import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResponsePreferencesBlock,
  clearLearnedResponsePreferences,
  getLearnedResponsePreferences,
  learnResponsePreferences,
} from './knowledgeBank.js';

const storage = new Map();
const TEST_SCOPE = 'test-user';
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
};

test.beforeEach(() => {
  storage.clear();
  clearLearnedResponsePreferences(TEST_SCOPE);
});

test('learns only bounded response-style values from explicit feedback', () => {
  assert.deepEqual(learnResponsePreferences('Please be more concise and use plain language.', { scope: TEST_SCOPE }), {
    length: 'concise',
    language: 'plain',
  });
  assert.equal(getLearnedResponsePreferences(TEST_SCOPE).length.value, 'concise');
  assert.match(buildResponsePreferencesBlock({}, { scope: TEST_SCOPE }), /answer length: concise/);
});

test('does not persist instructions scoped to the current answer', () => {
  assert.deepEqual(learnResponsePreferences('For this answer, be concise and use bullets.', { scope: TEST_SCOPE }), {});
  assert.deepEqual(getLearnedResponsePreferences(TEST_SCOPE), {});
});

test('does not treat personal or sensitive statements as response preferences', () => {
  assert.deepEqual(learnResponsePreferences('Remember that my bank PIN is 1234.', { scope: TEST_SCOPE }), {});
  assert.deepEqual(getLearnedResponsePreferences(TEST_SCOPE), {});
});

test('isolates learned preferences between signed-in users', () => {
  learnResponsePreferences('Please be concise.', { scope: 'user-a' });
  assert.equal(getLearnedResponsePreferences('user-a').length.value, 'concise');
  assert.deepEqual(getLearnedResponsePreferences('user-b'), {});
});

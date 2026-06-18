import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelChoice, toUiModelName } from './chat.js';

test('labels mira-v4 as normal Mira unless locked mode was requested', () => {
  assert.equal(toUiModelName('mira-v4'), 'mira');
  assert.equal(toUiModelName('mira-v4', { locked: true }), 'locked');
});

test('normal Mira selection does not resolve as locked when model ids overlap', () => {
  assert.equal(resolveModelChoice('mira', false, false), process.env.MIRA_MODEL || 'mira-v4');
  assert.equal(resolveModelChoice('locked', false, false), process.env.MIRA_LOCKED_MODEL || process.env.MIRA_MODEL || 'mira-v4');
});

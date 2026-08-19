import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CAPABILITIES } from './agentCapabilities.js';
import {
  buildRegressionValidationCalls,
  desktopGoalNeedsMoreWork,
} from './desktopAgentPolicy.js';

test('schedules one native regression suite after workspace edits', () => {
  const calls = buildRegressionValidationCalls();
  assert.deepEqual(calls, [
    { name: 'workspace.validate', arguments: {} },
  ]);
});

test('keeps the desktop agent working until inspection, mutation, execution and validation finish', () => {
  assert.deepEqual(desktopGoalNeedsMoreWork({
    request: { mutation: true, execution: true },
    successfulCalls: ['workspace.search'],
    validationFailures: ['npm test failed'],
  }), {
    inspection: false,
    mutation: true,
    execution: true,
    validation: true,
  });
  assert.deepEqual(desktopGoalNeedsMoreWork({
    request: { mutation: true, execution: true },
    successfulCalls: ['workspace.search', 'filesystem.replace', 'test.run'],
  }), {
    inspection: false,
    mutation: false,
    execution: false,
    validation: false,
  });
});

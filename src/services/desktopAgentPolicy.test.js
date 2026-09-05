import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CAPABILITIES } from './agentCapabilities.js';
import {
  buildDesktopWorkflowSteps,
  buildRegressionValidationCalls,
  desktopGoalNeedsMoreWork,
  desktopWorkflowStageForTool,
} from './desktopAgentPolicy.js';

test('builds fresh goal-specific workflow steps instead of exposing bootstrap tools', () => {
  assert.deepEqual(
    buildDesktopWorkflowSteps('Optimize the codebase performance', { mutation: true }).map((step) => step.title),
    ['Identify optimization targets', 'Apply focused optimizations', 'Measure and validate the result'],
  );
  assert.deepEqual(
    buildDesktopWorkflowSteps('Run the server please', { execution: true, serverStart: true }).map((step) => step.title),
    ['Inspect startup configuration', 'Launch the development server', 'Confirm the live server output'],
  );
});

test('keeps internal indexing within the visible inspection stage', () => {
  assert.equal(desktopWorkflowStageForTool(AGENT_CAPABILITIES.WORKSPACE_INDEX), 'inspect');
  assert.equal(desktopWorkflowStageForTool(AGENT_CAPABILITIES.FILE_REPLACE), 'act');
  assert.equal(desktopWorkflowStageForTool(AGENT_CAPABILITIES.WORKSPACE_VALIDATE), 'validate');
});

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

test('counts a launched workspace server as completed execution', () => {
  assert.equal(desktopGoalNeedsMoreWork({
    request: { execution: true },
    successfulCalls: ['filesystem.read', 'workspace.start'],
  }).execution, false);
});

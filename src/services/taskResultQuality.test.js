import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskResult } from './taskResultQuality.js';
import { runAgentTask, extractAgentTaskAnswer, extractAgentTaskFallback } from './agentTask.js';

const plan = JSON.stringify([
  { title: 'Review constraints', instruction: 'Review the workshop constraints', tool: 'reason' },
  { title: 'Prepare schedule', instruction: 'Prepare the workshop schedule', tool: 'reason' },
]);

test('rejects unrelated introductions and HTML but allows requested code, questions and refusals', () => {
  assert.throws(() => validateTaskResult('I am **MIRA**, an assistant.', 'Plan a workshop'), { name: 'InvalidTaskResultError' });
  assert.throws(() => validateTaskResult('<!doctype html><html>...</html>', 'Plan a workshop'), { name: 'InvalidTaskResultError' });
  assert.equal(validateTaskResult('<html>...</html>', 'Build a website'), '<html>...</html>');
  assert.equal(validateTaskResult('I am MIRA.', 'Tell me about yourself'), 'I am MIRA.');
  assert.equal(validateTaskResult('I cannot help with that request.', 'A prohibited request'), 'I cannot help with that request.');
});

test('invalid step results fail rather than being marked completed', async () => {
  const phases = [];
  const output = await runAgentTask({ goal: 'Plan a workshop', onPhase: p => phases.push(p), generate: async (_, options) =>
    options.phase === 'planning' ? plan : '<html><style>body { color: red }</style></html>' });
  assert.equal(phases.filter(p => p.phase === 'step-completed').length, 0);
  assert.equal(phases.filter(p => p.phase === 'step-error').length, 2);
  assert.equal(extractAgentTaskAnswer(output), '');
  assert.match(extractAgentTaskFallback(output), /webpage code instead/);
  assert.doesNotMatch(extractAgentTaskFallback(output), /<html>/);
});

test('unrelated final introductions are replaced by an honest failure summary', async () => {
  const output = await runAgentTask({ goal: 'Plan a workshop', generate: async (_, options) =>
    options.phase === 'planning' ? plan : options.phase === 'synthesizing' ? 'I am **MIRA**, your helpful assistant.' : 'Hold two sessions with a break.' });
  assert.equal(extractAgentTaskAnswer(output), '');
  assert.match(extractAgentTaskFallback(output), /couldn't finish a reliable final answer/);
  assert.doesNotMatch(extractAgentTaskFallback(output), /your helpful assistant/);
});

test('model cannot hide a failed step behind a success conclusion', async () => {
  let step = 0;
  const output = await runAgentTask({ goal: 'Plan a workshop', generate: async (_, options) => {
    if (options.phase === 'planning') return plan;
    if (options.phase === 'synthesizing') return 'Workshop plan: begin at 10am.';
    return ++step === 1 ? 'Confirmed: 20 attendees.' : '<html>unrelated output</html>';
  } });
  assert.match(extractAgentTaskAnswer(output), /1 of 2 parts failed/);
  assert.match(extractAgentTaskAnswer(output), /Prepare schedule/);
  assert.match(extractAgentTaskAnswer(output), /conclusions below are partial/);
});

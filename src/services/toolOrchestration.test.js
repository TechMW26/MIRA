import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolOutcome, runToolOrchestration } from './toolOrchestration.js';
const initialCall = { name: 'reminder.list', arguments: {} };
const control = (name, args) => `[MIRA_TOOL: ${JSON.stringify({ name, arguments: args })}]`;
test('orchestrator carries actual prior receipts into dependent tools and completion', async () => {
  const executions = []; let round = 0;
  const answer = await runToolOrchestration({ initialCall, initialResult: '[]', allowedTools: new Set(['reminder.create', 'reminder.update']), generate: async ({ receipts }) => {
    if (round++ === 0) { assert.equal(receipts[0].result, '[]'); return control('reminder.create', { title: 'Tea' }); }
    assert.equal(receipts[1].result, '{"id":"saved"}'); return 'Your reminder is set.';
  }, execute: async call => { executions.push(call); return '{"id":"saved"}'; } });
  assert.equal(executions.length, 1); assert.equal(answer, 'Your reminder is set.');
});
test('identical operations are not replayed and the model gets the existing receipt', async () => {
  let executions = 0, round = 0;
  const write = { name: 'reminder.create', arguments: { title: 'Tea' } };
  const answer = await runToolOrchestration({ initialCall: write, initialResult: '{"saved":true}', allowedTools: new Set(['reminder.create']), generate: async ({ receipts }) => {
    if (!round++) return control('reminder.create', { title: 'Tea' });
    assert.match(receipts.at(-1).result, /already has a receipt/); return 'No reminders are scheduled.';
  }, execute: async () => { executions++; } });
  assert.equal(executions, 0); assert.match(answer, /No reminders/);
});
test('a failed tool is preserved for a different correction route, not falsely completed', async () => {
  let round = 0;
  const answer = await runToolOrchestration({ initialCall, initialResult: '[]', allowedTools: new Set(['reminder.create']), generate: async ({ receipts }) => {
    if (!round++) return control('reminder.create', { title: 'Tea' });
    assert.equal(receipts.at(-1).success, false); assert.match(receipts.at(-1).result, /storage unavailable/); return 'The reminder could not be saved because storage is unavailable.';
  }, execute: async () => { throw new Error('storage unavailable'); } });
  assert.match(answer, /could not be saved/);
});
test('cancelled and unknown tool requests cannot execute, and bounded loops cannot claim completion', async () => {
  let executions = 0;
  await assert.rejects(runToolOrchestration({ initialCall, initialResult: '[]', allowedTools: new Set(), alive: () => false }), { name: 'AbortError' });
  await assert.rejects(runToolOrchestration({ initialCall, initialResult: '[]', allowedTools: new Set(), generate: async () => control('shell.run', { command: 'sh' }), execute: async () => executions++ }), /unavailable/);
  await assert.rejects(runToolOrchestration({ initialCall, initialResult: '[]', allowedTools: new Set(['reminder.list']), maxCalls: 1, generate: async () => control('reminder.list', {}), execute: async () => executions++ }), /operation limit/);
  assert.equal(executions, 0);
});
test('failed or uncertain structured output never becomes a successful receipt', () => {
  for (const payload of [{ success: false }, { ok: false }, { saved: false }, { success: true, uncertain: true }, { status: 'blocked' }, { exitCode: 2 }]) {
    assert.equal(normalizeToolOutcome(initialCall, JSON.stringify(payload)).success, false);
  }
  assert.equal(normalizeToolOutcome({ name: 'computer.task' }, 'Computer task needs attention: not visible').success, false);
  assert.equal(normalizeToolOutcome({ name: 'computer.task' }, 'Verified computer result: Music is playing.').success, true);
});
test('a failed read can retry the same call and the subsequent model sees both actual outcomes', async () => {
  let round = 0, executed = 0;
  const answer = await runToolOrchestration({ initialCall, initialResult: '{"success":false,"error":"temporary"}', allowedTools: new Set(['reminder.list']), generate: async ({ receipts }) => {
    if (!round++) { assert.equal(receipts[0].success, false); return control('reminder.list', {}); }
    assert.equal(receipts[1].success, true); assert.equal(receipts[1].result, '[]'); return 'No reminders are scheduled.';
  }, execute: async () => { executed++; return '[]'; } });
  assert.equal(executed, 1); assert.match(answer, /No reminders/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeHostTool } from './toolExecutor.js';
import { selectModelTools } from './modelTools.js';
import { getAgentRuntimeCapabilities } from './agentCapabilities.js';

test('linked workplace tools are advertised without removing existing capabilities', () => {
  const names = selectModelTools({ runtime: getAgentRuntimeCapabilities({}) }).map(tool => tool.function.name);
  for (const name of ['talio.context', 'talio.activity', 'talio.action', 'talio.receipt', 'web.search', 'reminder.create']) assert.ok(names.includes(name), name);
});
test('read tools only call their fixed operation', async () => {
  const calls = [];
  const value = await executeHostTool({ name: 'talio.context', arguments: { query: 'my meetings' } }, { workplaceRequest: async (...args) => { calls.push(args); return { success: true }; } });
  assert.deepEqual(calls, [['context', { query: 'my meetings' }]]);
  assert.equal(JSON.parse(value).success, true);
});
test('a rejected write confirmation performs no network mutation', async () => {
  const original = globalThis.window; let requests = 0;
  globalThis.window = { confirm: () => false };
  try {
    const value = await executeHostTool({ name: 'talio.action', arguments: { action: { type: 'send_message', fields: { recipient: 'A', content: 'Test' } } } }, { workplaceRequest: async () => { requests++; } });
    assert.equal(JSON.parse(value).cancelled, true); assert.equal(requests, 0);
  } finally { globalThis.window = original; }
});
test('a confirmed write gets a stable receipt ID and an uncertain failure is not retried', async () => {
  const original = globalThis.window; const calls = [];
  globalThis.window = { confirm: () => true };
  try {
    const value = JSON.parse(await executeHostTool({ name: 'talio.action', arguments: { action: { type: 'create_task', fields: { title: 'Test', assignees: ['me'] } } } }, { workplaceRequest: async (...args) => { calls.push(args); throw new Error('Network interrupted'); } }));
    assert.equal(value.success, false); assert.equal(value.uncertain, true); assert.equal(calls.length, 1);
    assert.equal(value.requestId, calls[0][1].requestId); assert.match(value.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(calls[0][1].confirmed, true); assert.match(value.instruction, /talio.receipt/);
  } finally { globalThis.window = original; }
});
test('cancelled runs cannot start a workplace request', async () => {
  let requests = 0;
  await assert.rejects(executeHostTool({ name: 'talio.context', arguments: {} }, { isCurrentRun: () => false, workplaceRequest: async () => { requests++; } }), /stopped/);
  assert.equal(requests, 0);
});
test('shared-chat author impersonation cannot borrow the current user’s workplace credentials', async () => {
  let requests = 0;
  await assert.rejects(executeHostTool({ name: 'talio.context', arguments: { query: 'my tasks' } }, { allowWorkplace: false, workplaceRequest: async () => { requests++; } }), /another chat participant/);
  assert.equal(requests, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runComputerTask, parseComputerDecision } from './computerTask.js';
import { readChatResponse, toolCallsToControl } from './api.js';
import { sanitizeTools } from '../../api/chat.js';

function bridgeFixture(handler) {
  const calls = [];
  const scope = { window: { miraDesktop: { invokeTool: async call => {
    calls.push(call.arguments);
    const defaults = { begin: { success: true, sessionId: 'task-1' }, observe: { success: true, observationId: `image-${calls.length}`, image: 'dGVzdA==', mimeType: 'image/jpeg', app: 'Calculator', targets: [], platform: 'darwin' }, act: { success: true, requiresVerification: true }, verify: { success: true }, cancel: { success: true } };
    return { ok: true, output: JSON.stringify(handler?.(call.arguments) ?? defaults[call.arguments.operation]) };
  } } } };
  return { scope, calls };
}
test('computer task observes input results before verified completion and always releases native session', async () => {
  const { scope, calls } = bridgeFixture(); let plans = 0;
  const result = await runComputerTask({ goal: 'Open Calculator', scope, analyze: async prompt => {
    assert.match(prompt, /Open Calculator/);
    return ++plans === 1 ? '{"status":"action","action":{"type":"open_app","name":"Calculator"}}' : '{"status":"done","message":"Calculator is open."}';
  } });
  assert.match(result, /Verified computer result/);
  assert.deepEqual(calls.map(c => c.operation), ['begin', 'observe', 'act', 'observe', 'verify', 'cancel']);
});
test('invalid planner output retries on a fresh observation without sending input', async () => {
  const { scope, calls } = bridgeFixture(); let plans = 0;
  await assert.rejects(runComputerTask({ goal: 'Inspect Calculator', scope, analyze: async () => ++plans === 1 ? 'not json' : '{"status":"blocked","message":"The requested app is unavailable."}' }), /needs attention/);
  assert.equal(calls.filter(c => c.operation === 'observe').length, 2);
  assert.equal(calls.filter(c => c.operation === 'act').length, 0);
});
test('cancellation during model analysis prevents later native input', async () => {
  const { scope, calls } = bridgeFixture(); let active = true;
  await assert.rejects(runComputerTask({ goal: 'Open Calculator', scope, alive: () => active, analyze: async () => {
    active = false; return '{"status":"action","action":{"type":"key","key":"enter"}}';
  } }), { name: 'AbortError' });
  assert.equal(calls.filter(c => c.operation === 'act').length, 0);
  assert.equal(calls.at(-1).operation, 'cancel');
});
test('changed completion screen is reobserved instead of falsely reported complete', async () => {
  let verifies = 0;
  const { scope, calls } = bridgeFixture(args => args.operation === 'verify' ? { success: ++verifies > 1 } : undefined);
  const result = await runComputerTask({ goal: 'Check Calculator', scope, analyze: async () => '{"status":"done","message":"Checked."}' });
  assert.match(result, /Verified/);
  assert.equal(calls.filter(c => c.operation === 'observe').length, 2);
});
test('unknown planner decisions fail closed', () => {
  assert.throws(() => parseComputerDecision('{"status":"maybe"}'), /invalid decision/);
  assert.throws(() => parseComputerDecision('{"status":"action"}'), /no grounded input/);
});
test('computer task survives server tool allowlisting and provider aliases', () => {
  const tools = sanitizeTools([{ type: 'function', function: { name: 'computer.task', parameters: { type: 'object' } } }]);
  assert.equal(tools.length, 1);
  assert.match(toolCallsToControl([{ function: { name: 'computer__task', arguments: '{"goal":"Open Calculator"}' } }]), /computer.task/);
});
test('fragmented DeepSeek tool calls are combined once before host execution', async () => {
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'computer__task', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"goal":"Open ' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Calculator"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  const response = new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  const chunks = [];
  const result = await readChatResponse(response, chunk => chunks.push(chunk.answerFull));
  assert.equal(chunks.length, 1);
  assert.match(result.answer, /"goal":"Open Calculator"/);
  assert.match(result.answer, /"name":"computer.task"/);
});

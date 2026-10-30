'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createComputerControl } = require('./computerControl.cjs');

async function fixture(t, overrides = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mira-computer-test-'));
  let now = 1000;
  let state = { success: true, accessibility: true, app: 'Calculator', pid: 10, windowId: 1, frame: { x: 0, y: 0, width: 400, height: 300 }, center: { x: 200, y: 150 }, keyIdleSeconds: 100 };
  const inputs = [];
  const control = createComputerControl({
    app: { getPath: () => folder, getAppPath: () => folder },
    desktopCapturer: { getSources: async () => [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('test-image') } }] },
    screen: { getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' },
    globalShortcut: { register: () => true, unregister: () => {} }, platform: 'darwin', now: () => now,
    runControl: async input => {
      if (input.type === 'status') return { ...state };
      if (input.type === 'ui_elements') return { pid: state.pid, elements: [{ role: 'AXTextField', label: 'Search', frame: { x: 400, y: 200, width: 200, height: 80 } }] };
      inputs.push(input); return { success: true };
    }, ...overrides,
  });
  t.after(async () => { control.cancel(); await fs.rm(folder, { recursive: true, force: true }); });
  const begin = () => control.handle({ operation: 'begin', goal: 'Open Calculator and calculate 2 + 2.' });
  return { control, inputs, begin, setTime: value => { now = value; }, setState: patch => { state = { ...state, ...patch }; } };
}

test('native control requires approval and OS grants before any screen capture', async t => {
  const f = await fixture(t, { systemPreferences: { isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => 'granted' } });
  await assert.rejects(f.begin(), /Accessibility and Screen Recording/);
  assert.equal(f.inputs.length, 0);
});
test('native control refuses denied application consent', async t => {
  const f = await fixture(t, { dialog: { showMessageBox: async () => ({ response: 0 }) } });
  await assert.rejects(f.begin(), /not approved/);
});
test('fresh grounded input consumes the observation and needs new verification', async t => {
  const f = await fixture(t), { sessionId } = await f.begin();
  const observation = await f.control.handle({ operation: 'observe', sessionId });
  assert.equal(observation.image, Buffer.from('test-image').toString('base64'));
  const result = await f.control.handle({ operation: 'act', sessionId, observationId: observation.observationId, action: { type: 'click', x: .5, y: .25 } });
  assert.equal(result.requiresVerification, true);
  assert.deepEqual(f.inputs, [{ type: 'click', x: 500, y: 200 }]);
  assert.equal((await f.control.handle({ operation: 'verify', sessionId, observationId: observation.observationId })).success, false);
  assert.equal((await f.control.handle({ operation: 'act', sessionId, observationId: observation.observationId, action: { type: 'key', key: 'enter' } })).success, false);
});
test('window changes, manual keyboard activity and stale observations block input', async t => {
  const f = await fixture(t), { sessionId } = await f.begin();
  let seen = await f.control.handle({ operation: 'observe', sessionId });
  f.setState({ windowId: 2 });
  assert.equal((await f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: { type: 'key', key: 'enter' } })).success, false);
  seen = await f.control.handle({ operation: 'observe', sessionId });
  f.setTime(3000); f.setState({ keyIdleSeconds: .1 });
  assert.equal((await f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: { type: 'key', key: 'enter' } })).success, false);
  f.setState({ keyIdleSeconds: 100 }); seen = await f.control.handle({ operation: 'observe', sessionId }); f.setTime(50000);
  assert.equal((await f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: { type: 'key', key: 'enter' } })).success, false);
  assert.equal(f.inputs.length, 0);
});
test('predictable editable batches work but submit batches and new tabs are rejected', async t => {
  const f = await fixture(t), { sessionId } = await f.begin();
  let seen = await f.control.handle({ operation: 'observe', sessionId });
  const input = args => f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: args });
  await assert.rejects(input({ type: 'batch', actions: [{ type: 'type', text: 'Message' }, { type: 'key', key: 'enter' }] }), /Unsupported/);
  await assert.rejects(input({ type: 'key', key: 'new_tab' }), /did not request a new tab/);
  assert.equal((await input({ type: 'batch', actions: [{ type: 'click', x: .5, y: .3 }, { type: 'key', key: 'select_all' }, { type: 'type', text: '2+2' }] })).success, true);
  assert.equal(f.inputs.length, 3);
  seen = await f.control.handle({ operation: 'observe', sessionId });
  assert.equal((await f.control.handle({ operation: 'verify', sessionId, observationId: seen.observationId })).success, true);
});
test('protected applications and wrong messaging channels cannot receive generated input', async t => {
  const f = await fixture(t), { sessionId } = await f.control.handle({ operation: 'begin', goal: 'Message Mansi on WhatsApp saying hello.' });
  f.setState({ app: 'Mail' });
  let seen = await f.control.handle({ operation: 'observe', sessionId });
  await assert.rejects(f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: { type: 'type', text: 'hello' } }), /channel/);
  f.setState({ app: 'Terminal' }); seen = await f.control.handle({ operation: 'observe', sessionId });
  await assert.rejects(f.control.handle({ operation: 'act', sessionId, observationId: seen.observationId, action: { type: 'type', text: 'echo test' } }), /protected/);
  assert.equal(f.inputs.length, 0);
});
test('revocation cancels a running session and requires new consent', async t => {
  const f = await fixture(t), { sessionId } = await f.begin();
  await f.control.handle({ operation: 'revoke' });
  await assert.rejects(f.control.handle({ operation: 'observe', sessionId }), /stopped or expired/);
});

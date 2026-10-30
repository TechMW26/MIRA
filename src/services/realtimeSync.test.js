import test from 'node:test';
import assert from 'node:assert/strict';
import { createThrottledRealtimeWriter } from './realtimeSync.js';

test('realtime writer coalesces rapid updates and persists the latest answer', async () => {
  const writes = [];
  const writer = createThrottledRealtimeWriter(async (payload) => {
    writes.push(payload);
  }, { intervalMs: 25 });

  writer.push({ content: 'H' });
  writer.push({ content: 'He' });
  writer.push({ content: 'Hello' });
  await writer.finish();

  assert.deepEqual(writes.at(-1), { content: 'Hello' });
  assert.ok(writes.length <= 2);
});

test('realtime writer waits for an active write before flushing its final update', async () => {
  const writes = [];
  let releaseFirst;
  const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
  const writer = createThrottledRealtimeWriter(async (payload) => {
    writes.push(payload.content);
    if (writes.length === 1) await firstWrite;
  }, { intervalMs: 25 });

  writer.push({ content: 'Partial' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  writer.push({ content: 'Complete' });
  const finishing = writer.finish();
  releaseFirst();
  await finishing;

  assert.deepEqual(writes, ['Partial', 'Complete']);
});

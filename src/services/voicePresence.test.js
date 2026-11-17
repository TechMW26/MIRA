import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceGate } from './voicePresence.js';

test('greets once for a stable arrival, not single frames or continuous faces', () => {
  const detect = createPresenceGate();
  assert.equal(detect(true, 0), null);
  assert.equal(detect(false, 200), null);
  assert.equal(detect(true, 300), null);
  assert.equal(detect(true, 1200), 'arrived');
  assert.equal(detect(true, 10000), null);
});
test('short occlusions do not re-greet; genuine departures allow a new arrival', () => {
  const detect = createPresenceGate();
  detect(true, 0); detect(true, 1000);
  detect(false, 2000); assert.equal(detect(true, 4000), null);
  detect(false, 6000); assert.equal(detect(false, 11000), 'left');
  detect(true, 12000); assert.equal(detect(true, 13000), 'arrived');
});

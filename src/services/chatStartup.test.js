import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSendGate, waitForConversationRoute } from './chatStartup.js';

test('admits only one ordinary send while chat startup is in flight', () => {
  const gate = createChatSendGate();
  assert.equal(gate.acquire(1), true);
  assert.equal(gate.acquire(2), false);
  gate.release(2);
  assert.equal(gate.isActive(), true);
  gate.release(1);
  assert.equal(gate.acquire(3), true);
  gate.reset();
  assert.equal(gate.isActive(), false);
});

test('allows an explicit steering send to replace the active run', () => {
  const gate = createChatSendGate();
  assert.equal(gate.acquire(1), true);
  assert.equal(gate.acquire(2, { interrupt: true }), true);
  gate.release(1);
  assert.equal(gate.isActive(), true);
  gate.release(2);
  assert.equal(gate.isActive(), false);
});

test('waits for the unique conversation route before resolving startup', async () => {
  let route = { projectId: null, conversationId: null };
  let yields = 0;
  const committed = await waitForConversationRoute(
    () => route,
    { projectId: 'project-1', conversationId: 'chat-1' },
    {
      schedule: async () => {
        yields += 1;
        if (yields === 2) route = { projectId: 'project-1', conversationId: 'chat-1' };
      },
      maxAttempts: 3,
    },
  );

  assert.equal(yields, 2);
  assert.equal(committed.conversationId, 'chat-1');
});

test('fails closed when the requested chat URL is never committed', async () => {
  await assert.rejects(
    waitForConversationRoute(
      () => ({ projectId: null, conversationId: null }),
      { projectId: null, conversationId: 'chat-1' },
      { schedule: async () => {}, maxAttempts: 2 },
    ),
    /chat URL could not be prepared/i,
  );
});

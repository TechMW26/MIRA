import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMessages } from './messageOrder.js';
import { snapshotFromValue } from './firebaseRest.js';
import { buildChatDisplayMessages } from './chatDisplayMessages.js';

test('REST key order cannot put an assistant before its earlier question', () => {
  const rows = [];
  snapshotFromValue({ assistant: { role: 'assistant', timestamp: 101 }, user: { role: 'user', timestamp: 100 } })
    .forEach(child => rows.push({ id: child.key, ...child.val() }));
  assert.deepEqual(orderMessages(rows).map(m => m.role), ['user', 'assistant']);
});

test('delayed local question remains before streaming assistant without a duplicate bubble', () => {
  const rows = [
    { id: 'answer', role: 'assistant', timestamp: 101, isStreaming: true },
    { id: 'local-user', role: 'user', timestamp: 100, localEcho: true },
  ];
  const displayed = buildChatDisplayMessages({ messages: orderMessages(rows), isGenerating: true, streamingContent: 'Answer' });
  assert.deepEqual(displayed.map(m => m.id), ['local-user', 'answer']);
  assert.equal(displayed[1].content, 'Answer');
  assert.equal(rows[0].id, 'answer');
});

test('equal timestamps put questions first; updates and reversed cache preserve turn order', () => {
  const rows = [
    { id: 'a2', role: 'assistant', timestamp: 200, updatedAt: 900 },
    { id: 'u2', role: 'user', timestamp: 200 },
    { id: 'a1', role: 'assistant', timestamp: 101, updatedAt: 1000 },
    { id: 'u1', role: 'user', timestamp: 100 },
  ];
  assert.deepEqual(orderMessages(rows).map(m => m.id), ['u1', 'a1', 'u2', 'a2']);
});

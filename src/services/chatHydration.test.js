import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSING_CONVERSATION_GRACE_MS,
  conversationHydrationTimeline,
  hasConversationHydrated,
} from './chatHydration.js';

test('preserves a just-sent optimistic message while its new conversation hydrates', () => {
  const previous = [
    { id: 'history', workspaceHistory: true, role: 'assistant' },
    { id: 'local-user', localEcho: true, role: 'user', content: 'Hello' },
    { id: 'old-server', role: 'assistant', content: 'Stale chat' },
  ];
  assert.deepEqual(
    conversationHydrationTimeline(previous, { preserveOptimistic: true }).map((message) => message.id),
    ['history', 'local-user'],
  );
  assert.deepEqual(conversationHydrationTimeline(previous), []);
});

test('recognizes authoritative hydration and provides enough subscription grace', () => {
  assert.equal(hasConversationHydrated([{ id: 'local', localEcho: true }]), false);
  assert.equal(hasConversationHydrated([{ id: 'server', role: 'user' }]), true);
  assert.ok(MISSING_CONVERSATION_GRACE_MS >= 2_500);
});

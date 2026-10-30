import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSING_CONVERSATION_GRACE_MS,
  conversationHydrationTimeline,
  hasConversationHydrated,
  mergeRealtimeAssistantSnapshot,
  shouldDeferMissingConversationReset,
  shouldRecoverInterruptedResponse,
  ORPHANED_RESPONSE_GRACE_MS,
} from './chatHydration.js';

test('recovery never mistakes a current-session response or slow provider for a reload', () => {
  const sessionStartedAt = 1_000_000;
  const message = {role:'assistant',isStreaming:true,streamStartedAt:sessionStartedAt+1};
  assert.equal(shouldRecoverInterruptedResponse(message,{sessionStartedAt,now:sessionStartedAt+ORPHANED_RESPONSE_GRACE_MS*2}), false);
  const earlier = {...message,streamStartedAt:sessionStartedAt-1000};
  assert.equal(shouldRecoverInterruptedResponse(earlier,{sessionStartedAt,now:sessionStartedAt+2500}), false);
  assert.equal(shouldRecoverInterruptedResponse(earlier,{sessionStartedAt,now:sessionStartedAt+ORPHANED_RESPONSE_GRACE_MS}), true);
  assert.equal(shouldRecoverInterruptedResponse(earlier,{sessionStartedAt,now:sessionStartedAt+ORPHANED_RESPONSE_GRACE_MS,active:true}), false);
  assert.equal(shouldRecoverInterruptedResponse({...earlier,streamUpdatedAt:sessionStartedAt},{sessionStartedAt,now:sessionStartedAt+2500}), false);
});

test('delayed streaming snapshots cannot reopen a completed answer; local recovery can receive a live result', () => {
  const complete = {role:'assistant',isStreaming:false,content:'Hello!',streamStartedAt:100};
  const stale = {...complete,isStreaming:true,content:''};
  assert.equal(mergeRealtimeAssistantSnapshot(stale,complete).isStreaming,false);
  assert.equal(mergeRealtimeAssistantSnapshot(stale,complete).content,'Hello!');
  assert.equal(mergeRealtimeAssistantSnapshot({...stale,content:'Continuing'}, {...complete,recoveredLocally:true}).isStreaming,true);
});

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

test('never clears a locally-created conversation while subscriptions catch up', () => {
  assert.equal(shouldDeferMissingConversationReset({
    conversationId: 'new-chat',
    pendingConversationId: 'new-chat',
    conversationsReady: true,
    existsInList: false,
  }), true);
  assert.equal(shouldDeferMissingConversationReset({
    conversationId: 'missing-chat',
    pendingConversationId: null,
    conversationsReady: true,
    existsInList: false,
  }), false);
});

test('never lets a late realtime snapshot replace a persisted generated image', () => {
  const persisted = {
    id: 'assistant-image',
    role: 'assistant',
    content: '[IMAGE_GEN: a real algae tree]',
    isStreaming: false,
    generatedMedia: {
      images: [{ url: 'https://blob.example/algae-tree.png' }],
      generation: { mode: 'generate' },
    },
  };
  const staleSnapshot = {
    id: 'assistant-image',
    role: 'assistant',
    content: '[IMAGE_GEN: a real algae tree]',
    isStreaming: false,
  };

  assert.deepEqual(
    mergeRealtimeAssistantSnapshot(staleSnapshot, persisted).generatedMedia,
    persisted.generatedMedia,
  );
});

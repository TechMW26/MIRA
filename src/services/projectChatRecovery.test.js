import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectConversationTarget } from './projectChatRecovery.js';

test('replaces a deleted project conversation instead of writing orphan messages', () => {
  assert.deepEqual(resolveProjectConversationTarget({
    projectId: 'project-1',
    conversationId: 'deleted-chat',
    conversation: null,
  }), {
    conversationId: null,
    recoveredMissingConversation: true,
  });
});

test('keeps valid project and personal conversation targets', () => {
  assert.deepEqual(resolveProjectConversationTarget({
    projectId: 'project-1',
    conversationId: 'chat-1',
    conversation: { id: 'chat-1' },
  }), {
    conversationId: 'chat-1',
    recoveredMissingConversation: false,
  });
  assert.deepEqual(resolveProjectConversationTarget({
    conversationId: 'personal-chat',
  }), {
    conversationId: 'personal-chat',
    recoveredMissingConversation: false,
  });
});

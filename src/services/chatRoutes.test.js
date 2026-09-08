import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatPath, parseChatRoute } from './chatRoutes.js';

test('builds stable paths for personal and project chats', () => {
  assert.equal(buildChatPath(), '/');
  assert.equal(buildChatPath({ conversationId: 'chat 1' }), '/chat/chat%201');
  assert.equal(buildChatPath({ projectId: 'project/1' }), '/project/project%2F1');
  assert.equal(
    buildChatPath({ projectId: 'project 1', conversationId: 'chat/2' }),
    '/project/project%201/chat/chat%2F2',
  );
});

test('parses stable paths and legacy query links', () => {
  assert.deepEqual(parseChatRoute('/chat/chat%201'), {
    managed: true,
    projectId: null,
    conversationId: 'chat 1',
    legacy: false,
  });
  assert.deepEqual(parseChatRoute('/project/p1/chat/c1'), {
    managed: true,
    projectId: 'p1',
    conversationId: 'c1',
    legacy: false,
  });
  assert.deepEqual(parseChatRoute('/', '?p=p1&c=c1'), {
    managed: true,
    projectId: 'p1',
    conversationId: 'c1',
    legacy: true,
  });
});

test('does not claim unrelated application routes', () => {
  assert.equal(parseChatRoute('/auth').managed, false);
  assert.equal(parseChatRoute('/space/shared').managed, false);
});

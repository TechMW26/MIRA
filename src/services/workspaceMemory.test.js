import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceHistoryMessages,
  buildWorkspaceMemoryPrompt,
  mergeWorkspaceHistoryMessages,
} from './workspaceMemory.js';

test('workspace memory combines durable instructions with recent chats and changes', () => {
  const prompt = buildWorkspaceMemoryPrompt({
    instructions: '# Instructions\nUse pnpm and preserve the API contract.',
    events: [
      { type: 'chat', turnId: 'one', user: 'Where is auth?', assistant: 'Auth is in src/auth.js.' },
      { type: 'change', path: 'src/auth.js', at: 1 },
    ],
  });
  assert.match(prompt, /Use pnpm/);
  assert.match(prompt, /Where is auth/);
  assert.match(prompt, /src\/auth\.js/);
});

test('workspace memory removes duplicate persisted turns', () => {
  const prompt = buildWorkspaceMemoryPrompt({
    events: [
      { type: 'chat', turnId: 'same', user: 'old', assistant: 'old answer' },
      { type: 'chat', turnId: 'same', user: 'new', assistant: 'new answer' },
    ],
  });
  assert.doesNotMatch(prompt, /old answer/);
  assert.match(prompt, /new answer/);
});

test('workspace history restores chat bubbles and keeps the newest saved turn', () => {
  const messages = buildWorkspaceHistoryMessages({
    events: [
      { type: 'chat', turnId: 'same', user: 'old', assistant: 'old answer', at: 1 },
      { type: 'chat', turnId: 'same', user: 'new', assistant: 'new answer', at: 2 },
    ],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, 'new');
  assert.equal(messages[1].content, 'new answer');
  assert.equal(messages[1].workspaceTurnId, 'same');
});

test('live Firebase messages replace their matching local workspace turn', () => {
  const history = buildWorkspaceHistoryMessages({
    events: [{ type: 'chat', turnId: 'assistant-1', user: 'question', assistant: 'answer' }],
  });
  const live = [
    { id: 'user-1', role: 'user', content: 'question' },
    { id: 'assistant-1', role: 'assistant', content: 'answer' },
  ];
  assert.deepEqual(mergeWorkspaceHistoryMessages(history, live), live);
});

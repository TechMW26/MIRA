import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatDisplayMessages } from './chatDisplayMessages.js';

test('adds a pending MIRA bubble while generation starts after a user message', () => {
  const messages = [{ id: 'user-1', role: 'user', content: 'Research this' }];
  const displayed = buildChatDisplayMessages({ messages, isGenerating: true });

  assert.equal(displayed.length, 2);
  assert.equal(displayed[1].role, 'assistant');
  assert.equal(displayed[1].content, '');
  assert.equal(displayed[1].isStreaming, true);
});

test('keeps the pending MIRA bubble through thinking and visible streaming', () => {
  const messages = [{ id: 'user-1', role: 'user', content: 'Research this' }];
  const thinking = buildChatDisplayMessages({
    messages,
    isGenerating: true,
    thinkingContent: 'Reviewing the request',
  });
  assert.equal(thinking[1].thinkingContent, 'Reviewing the request');
  assert.equal(thinking[1].isThinkingActive, true);

  const responding = buildChatDisplayMessages({
    messages,
    isGenerating: true,
    streamingContent: 'Here is the answer',
    thinkingContent: 'Reviewing the request',
  });
  assert.equal(responding[1].content, 'Here is the answer');
  assert.equal(responding[1].isThinkingActive, false);
});

test('updates an existing assistant placeholder without adding a duplicate', () => {
  const messages = [
    { id: 'user-1', role: 'user', content: 'Hello' },
    { id: 'assistant-1', role: 'assistant', content: '' },
  ];
  const displayed = buildChatDisplayMessages({
    messages,
    isGenerating: true,
    streamingContent: 'Hello back',
  });

  assert.equal(displayed.length, 2);
  assert.equal(displayed[1].id, 'assistant-1');
  assert.equal(displayed[1].content, 'Hello back');
});

test('does not add a pending bubble when generation is idle', () => {
  const messages = [{ id: 'user-1', role: 'user', content: 'Hello' }];
  assert.equal(buildChatDisplayMessages({ messages, isGenerating: false }), messages);
});


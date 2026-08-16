import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueuePrompt,
  MAX_PROMPT_QUEUE,
  removeQueuedPrompt,
  takeNextQueuedPrompt,
  updateQueuedPrompt,
} from '../utils/promptQueue.js';

test('prompt queue drains in FIFO order', () => {
  const queue = [
    { id: 'one', content: 'First' },
    { id: 'two', content: 'Second' },
  ];
  const { next, remaining } = takeNextQueuedPrompt(queue);
  assert.equal(next.id, 'one');
  assert.deepEqual(remaining, [queue[1]]);
});

test('queued prompts can be removed without reordering the rest', () => {
  const queue = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  assert.deepEqual(removeQueuedPrompt(queue, 'two'), [{ id: 'one' }, { id: 'three' }]);
});

test('queued prompts can be edited without losing identity or attachments', () => {
  const attachments = [{ name: 'reference.png', isImage: true }];
  const queue = [{ id: 'one', content: 'Before', attachments, queuedAt: 123 }];
  const updated = updateQueuedPrompt(queue, 'one', { content: '  After  ', id: 'changed', queuedAt: 999 });

  assert.deepEqual(updated, [{ id: 'one', content: 'After', attachments, queuedAt: 123 }]);
});

test('prompt queue has a bounded in-memory size', () => {
  const queue = Array.from({ length: MAX_PROMPT_QUEUE }, (_, index) => ({ id: String(index) }));
  assert.equal(enqueuePrompt(queue, { id: 'overflow' }), queue);
});

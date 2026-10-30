import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractContextEntities,
  getLatestConversationSubject,
} from './conversationContext.js';

test('ignores sentence-opening discourse words when resolving the latest subject', () => {
  const subject = getLatestConversationSubject([
    { role: 'assistant', content: 'Canact is a people ratings and civic score application.' },
    { role: 'user', content: 'We call this civic score the Canact Score.' },
    { role: 'user', content: 'Right, can you research how we can make this app more engaging?' },
  ]);
  assert.match(subject, /Canact/i);
  assert.notEqual(subject, 'Right');
});

test('keeps real names while filtering conversational filler', () => {
  assert.deepEqual(extractContextEntities('Okay, Ankita Pandey is a creator in Lucknow.'), [
    'Ankita Pandey',
    'Lucknow',
  ]);
});

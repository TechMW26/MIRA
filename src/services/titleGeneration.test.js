import test from 'node:test';
import assert from 'node:assert/strict';
import { generateConversationTitle, generateTitle } from '../utils/helpers.js';

test('creates concise chat titles of no more than eight words', () => {
  const title = generateTitle('Please tell me something about the Algae Tree in Bhopal and how it works');
  const words = title.split(/\s+/);
  assert.ok(words.length > 0);
  assert.ok(words.length <= 8);
  assert.equal(title, 'The Algae Tree in Bhopal and how it');
});

test('does not pad short chat topics with generic filler', () => {
  assert.equal(generateTitle('Tell me about the Algae Tree'), 'The Algae Tree');
});

test('refreshes a title from recent user conversation topics', async () => {
  const title = await generateConversationTitle([
    { role: 'user', content: 'Help me understand solar algae trees' },
    { role: 'assistant', content: 'They use microalgae.' },
    { role: 'user', content: 'Compare their carbon capture in cities' },
  ]);
  assert.ok(title.split(/\s+/).length <= 8);
  assert.match(title, /solar algae trees/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expressionForAssistantContent,
  expressionForUserContent,
  messageHasError,
  resolveMiraExpression,
  shouldShowMiraWelcome,
} from './miraIdentity.js';

test('MIRA keeps one chat transition while a routed conversation hydrates', () => {
  assert.equal(shouldShowMiraWelcome(null, []), true);
  assert.equal(shouldShowMiraWelcome('conversation-1', []), false);
  assert.equal(shouldShowMiraWelcome(null, [{ role: 'user', content: 'Hello' }]), false);
});

test('MIRA identity prioritizes voice and failure states', () => {
  assert.equal(resolveMiraExpression({ voiceStatus: 'listening' }), 'attentive');
  assert.equal(resolveMiraExpression({ voiceStatus: 'speaking' }), 'neutral');
  assert.equal(resolveMiraExpression({ voiceStatus: 'error', isGenerating: true }), 'sad');
});

test('MIRA identity reflects search, workflow, and response states', () => {
  assert.equal(resolveMiraExpression({ isSearching: true }), 'curious');
  assert.equal(resolveMiraExpression({ taskWorkflow: { status: 'running', phase: 'planning' } }), 'curious');
  assert.equal(resolveMiraExpression({ taskWorkflow: { status: 'running', phase: 'executing' } }), 'attentive');
  assert.equal(resolveMiraExpression({ taskWorkflow: { status: 'running', phase: 'synthesizing' } }), 'excited');
  assert.equal(resolveMiraExpression({ taskWorkflow: { status: 'running', phase: 'responding' } }), 'proud');
  assert.equal(resolveMiraExpression({ isGenerating: true }), 'attentive');
});

test('MIRA identity uses nuanced positive expressions for response meaning', () => {
  assert.equal(expressionForAssistantContent('Everything is fixed and tests passed.'), 'proud');
  assert.equal(expressionForAssistantContent('Thanks — I appreciate that.'), 'shy');
  assert.equal(expressionForAssistantContent('Wow, that result is remarkable.'), 'surprised');
  assert.equal(expressionForAssistantContent('Haha, that was funny.'), 'laughing');
  assert.equal(expressionForAssistantContent('That name could mean several things.'), 'confused');
});

test('MIRA identity recognizes assistant errors without misclassifying user text', () => {
  assert.equal(messageHasError({ role: 'assistant', content: 'The service timed out.' }), true);
  assert.equal(messageHasError({ role: 'user', content: 'Fix this error' }), false);
  assert.equal(resolveMiraExpression({ lastMessage: { role: 'assistant', content: 'Sorry, something went wrong.' } }), 'sad');
});

test('MIRA returns to neutral after an ordinary completed chat response', () => {
  assert.equal(resolveMiraExpression({ lastMessage: { role: 'assistant', content: 'Here is the answer.' } }), 'neutral');
});

test('MIRA reacts to the actual tone of the latest user turn', () => {
  assert.equal(expressionForUserContent('Mira, you are completely useless.'), 'angry');
  assert.equal(expressionForUserContent('I am feeling very sad today.'), 'sad');
  assert.equal(expressionForUserContent('Amazing work, thank you!'), 'shy');
  assert.equal(expressionForUserContent('What does this result mean?'), 'curious');
  assert.equal(resolveMiraExpression({
    isGenerating: true,
    latestUserMessage: { role: 'user', content: 'You are an idiot, Mira.' },
  }), 'angry');
});

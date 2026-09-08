import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompanionUserMessage,
  DESKTOP_COMPANION_TOOLS,
  DESKTOP_SCREEN_CONTEXT_TOOL_NAME,
  isDesktopScreenContextCall,
  visibleCompanionMessage,
} from './companionChat.js';
import { MODEL_TOOLS } from './modelTools.js';

test('companion messages stay concise when no screen context is attached', () => {
  assert.equal(buildCompanionUserMessage('  explain   this error  '), 'explain this error');
  assert.equal(visibleCompanionMessage('  explain   this error  '), 'explain this error');
});

test('screen evidence is clearly delimited and labelled', () => {
  const message = buildCompanionUserMessage('What should I do?', {
    sourceName: 'Built-in display',
    analysis: 'A settings dialog shows an unavailable permission.',
  });
  assert.match(message, /<screen_context>/);
  assert.match(message, /Captured source: Built-in display/);
  assert.match(message, /unavailable permission/);
});

test('empty companion queries are rejected', () => {
  assert.throws(() => buildCompanionUserMessage('   '), /quick question/i);
});

test('desktop companion exposes one bounded screen-context tool', () => {
  assert.equal(DESKTOP_COMPANION_TOOLS.length, 1);
  assert.equal(DESKTOP_COMPANION_TOOLS[0].function.name, DESKTOP_SCREEN_CONTEXT_TOOL_NAME);
  assert.deepEqual(DESKTOP_COMPANION_TOOLS[0].function.parameters.required, ['focus']);
  assert.equal(isDesktopScreenContextCall({ name: DESKTOP_SCREEN_CONTEXT_TOOL_NAME }), true);
  assert.equal(isDesktopScreenContextCall({ name: 'web.search' }), false);
  assert.equal(
    MODEL_TOOLS.some((tool) => tool.function.name === DESKTOP_SCREEN_CONTEXT_TOOL_NAME),
    false,
    'the regular web chat tool set must not expose native screen capture',
  );
});

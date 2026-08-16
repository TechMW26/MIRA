import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGreetingResponse,
  getMostRecentAssistantMessage,
  isSimpleGreeting,
} from './contextPolicy.js';
import { selectModelTools } from './modelTools.js';

test('simple greetings form a hard text-only context boundary', () => {
  assert.equal(isSimpleGreeting('Hey'), true);
  assert.equal(isSimpleGreeting('Good morning!'), true);
  assert.equal(isSimpleGreeting('Hey, generate an image'), false);
  assert.doesNotMatch(buildGreetingResponse('Hey'), /IMAGE_GEN|MIRA_TOOL/i);
  assert.deepEqual(selectModelTools({ disableTools: true }), []);
});

test('media generation tools require current-turn media intent', () => {
  const generalTools = selectModelTools();
  assert.equal(generalTools.some((tool) => tool.function.name === 'image.generate'), false);
  assert.equal(generalTools.some((tool) => tool.function.name === 'video.generate'), false);

  const imageTools = selectModelTools({ allowImageGeneration: true });
  assert.equal(imageTools.some((tool) => tool.function.name === 'image.generate'), true);
  assert.equal(imageTools.some((tool) => tool.function.name === 'video.generate'), false);
});

test('only the most recent assistant turn can anchor a refinement', () => {
  const latest = getMostRecentAssistantMessage([
    { role: 'assistant', content: '[IMAGE_GEN: an old scene]' },
    { role: 'user', content: 'Explain gravity' },
    { role: 'assistant', content: 'Gravity attracts masses.' },
  ]);
  assert.equal(latest.content, 'Gravity attracts masses.');
});

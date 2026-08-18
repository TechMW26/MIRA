import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGreetingResponse,
  getPreviousGeneratedImageContext,
  getMostRecentAssistantMessage,
  isPreviousImageEditRequest,
  isSimpleGreeting,
} from './contextPolicy.js';
import { selectModelTools } from './modelTools.js';

test('simple greetings form a hard text-only context boundary', () => {
  assert.equal(isSimpleGreeting('Hey'), true);
  assert.equal(isSimpleGreeting('Good morning!'), true);
  assert.equal(isSimpleGreeting('Hello, ssup ?'), true);
  assert.equal(isSimpleGreeting("Hey, what's up?"), true);
  assert.equal(isSimpleGreeting('Yo sup'), true);
  assert.equal(isSimpleGreeting('Hey, generate an image'), false);
  assert.equal(isSimpleGreeting('Hello, search the latest news'), false);
  assert.doesNotMatch(buildGreetingResponse('Hey'), /IMAGE_GEN|MIRA_TOOL/i);
  assert.deepEqual(selectModelTools({ disableTools: true }), []);
});

test('routes only explicit previous-image edits through image context', () => {
  assert.equal(isPreviousImageEditRequest('Make an image of a blue elephant'), false);
  assert.equal(isPreviousImageEditRequest('Change the previous image background to blue'), true);
  assert.equal(isPreviousImageEditRequest('Refine this generated image and keep the face'), true);
  assert.equal(isPreviousImageEditRequest('Make it brighter'), true);

  assert.deepEqual(getPreviousGeneratedImageContext([
    {
      role: 'assistant',
      content: '[IMAGE_GEN: a studio portrait]',
      generatedMedia: { images: [{ url: 'https://blob.example/portrait.png' }] },
    },
    { role: 'user', content: 'That looks good.' },
    { role: 'assistant', content: 'Glad you like it.' },
  ]), {
    prompt: 'a studio portrait',
    referenceImage: 'https://blob.example/portrait.png',
  });
});

test('media generation tools require current-turn media intent', () => {
  const generalTools = selectModelTools();
  assert.equal(generalTools.some((tool) => tool.function.name === 'image.generate'), false);
  assert.equal(generalTools.some((tool) => tool.function.name === 'video.generate'), false);

  const imageTools = selectModelTools({ allowImageGeneration: true });
  assert.equal(imageTools.some((tool) => tool.function.name === 'image.generate'), true);
  assert.equal(imageTools.some((tool) => tool.function.name === 'video.generate'), false);
});

test('web search can be withheld for self-contained turns', () => {
  const tools = selectModelTools({ allowWebSearch: false });
  assert.equal(tools.some((tool) => tool.function.name === 'web.search'), false);
  assert.equal(tools.some((tool) => tool.function.name === 'task.run'), true);
});

test('only the most recent assistant turn can anchor a refinement', () => {
  const latest = getMostRecentAssistantMessage([
    { role: 'assistant', content: '[IMAGE_GEN: an old scene]' },
    { role: 'user', content: 'Explain gravity' },
    { role: 'assistant', content: 'Gravity attracts masses.' },
  ]);
  assert.equal(latest.content, 'Gravity attracts masses.');
});

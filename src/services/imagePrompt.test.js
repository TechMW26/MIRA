import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanImagePrompt,
  imagePromptSeed,
  normalizeImageGenerationOutput,
  resolveImageSceneContext,
} from './imagePrompt.js';

test('resolves above-scene references and rejects clarification text as a prompt', () => {
  const scene = 'A red fox beside a blue lake under snowy mountains.';
  const request = 'Can you create an image of the above scene!';
  const context = resolveImageSceneContext(request, [{role:'assistant',content:scene}]);
  assert.equal(context, scene);
  const output = normalizeImageGenerationOutput('I am ready to help. Please provide the details of the scene.', request, context);
  assert.ok(output.includes(scene));
  assert.ok(!output.includes('Please provide'));
  assert.ok(!output.includes('ADDITIVE VISUAL'));
  assert.ok(!normalizeImageGenerationOutput('[IMAGE_GEN: random portrait]', request).includes('[IMAGE_GEN:'));
  assert.equal(resolveImageSceneContext('Create an image of a yellow boat', [{role:'assistant',content:scene}]), '');
});

test('falls back to the user subject when the model returns a placeholder', () => {
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: ...]', 'Please generate an image of an elephant'),
    '[IMAGE_GEN: MANDATORY USER REQUIREMENTS (preserve every detail exactly): an elephant]',
  );
});

test('rejects unrelated generated prompts while preserving faithful enhancements', () => {
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: smiling family portrait]', 'Generate an image of an elephant'),
    '[IMAGE_GEN: MANDATORY USER REQUIREMENTS (preserve every detail exactly): an elephant]',
  );
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: majestic African elephant on a golden savanna]', 'Generate an image of an elephant'),
    '[IMAGE_GEN: MANDATORY USER REQUIREMENTS (preserve every detail exactly): an elephant\n\nADDITIVE VISUAL REFINEMENT (must not override the requirements above): majestic African elephant on a golden savanna]',
  );
});

test('preserves counts, attributes, exact text, composition, and exclusions from a detailed request', () => {
  const userPrompt = 'Generate exactly 3 elephants, the smallest wearing a red hat, beside a sign reading "SAVE WATER", low-angle composition, 16:9, with no people.';
  const result = normalizeImageGenerationOutput(
    '[IMAGE_GEN: elephants in a cinematic savanna with warm rim lighting]',
    userPrompt,
  );

  assert.match(result, /MANDATORY USER REQUIREMENTS/);
  for (const detail of ['3 elephants', 'smallest wearing a red hat', '"SAVE WATER"', 'low-angle', '16:9', 'no people']) {
    assert.ok(result.includes(detail), `missing preserved detail: ${detail}`);
  }
  assert.match(result, /ADDITIVE VISUAL REFINEMENT/);
});

test('keeps the base scene and applies every follow-up correction as an explicit override', () => {
  const result = normalizeImageGenerationOutput(
    '[IMAGE_GEN: polished portrait with balanced studio lighting]',
    'Change the hat to blue, remove the child, and keep the same camera angle',
    'A family portrait with a child, a red hat, and a low camera angle',
  );

  assert.match(result, /BASE SCENE/);
  assert.match(result, /family portrait with a child, a red hat, and a low camera angle/);
  assert.match(result, /MANDATORY USER CHANGES/);
  assert.match(result, /Change the hat to blue, remove the child, and keep the same camera angle/);
  assert.match(result, /override conflicting base details/);
});

test('cleans image request boilerplate and derives prompt-specific seeds', () => {
  assert.equal(cleanImagePrompt('Please create an image of a red fox'), 'a red fox');
  assert.notEqual(imagePromptSeed('elephant'), imagePromptSeed('family portrait'));
});

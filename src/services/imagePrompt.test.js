import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanImagePrompt,
  imagePromptSeed,
  normalizeImageGenerationOutput,
} from './imagePrompt.js';

test('falls back to the user subject when the model returns a placeholder', () => {
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: ...]', 'Please generate an image of an elephant'),
    '[IMAGE_GEN: an elephant]',
  );
});

test('rejects unrelated generated prompts while preserving faithful enhancements', () => {
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: smiling family portrait]', 'Generate an image of an elephant'),
    '[IMAGE_GEN: an elephant]',
  );
  assert.equal(
    normalizeImageGenerationOutput('[IMAGE_GEN: majestic African elephant on a golden savanna]', 'Generate an image of an elephant'),
    '[IMAGE_GEN: majestic African elephant on a golden savanna]',
  );
});

test('cleans image request boilerplate and derives prompt-specific seeds', () => {
  assert.equal(cleanImagePrompt('Please create an image of a red fox'), 'a red fox');
  assert.notEqual(imagePromptSeed('elephant'), imagePromptSeed('family portrait'));
});

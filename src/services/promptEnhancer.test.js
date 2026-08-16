import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeOriginalImageRequest,
  shouldRunEnhancer,
} from './promptEnhancer.js';

test('runs the enhancer for short image requests but not greetings or video', () => {
  const base = {
    content: 'Generate a red elephant',
    hasImages: false,
    hasAttachments: false,
    isReplay: false,
    isGreeting: false,
    isDocument: false,
  };

  assert.equal(shouldRunEnhancer({ ...base, interpretation: { imageIntent: true } }), true);
  assert.equal(shouldRunEnhancer({ ...base, interpretation: { videoIntent: true } }), false);
  assert.equal(shouldRunEnhancer({ ...base, isGreeting: true, interpretation: { imageIntent: true } }), false);
});

test('image refinement carries the complete original request as mandatory data', () => {
  const original = 'Create exactly 3 elephants; the smallest wears a red hat, a sign says "SAVE WATER", low-angle, 16:9, no people.';
  const result = mergeOriginalImageRequest(original, 'A cinematic savanna scene with warm rim lighting.');

  assert.match(result, /MANDATORY USER REQUIREMENTS/);
  assert.ok(result.includes(original));
  assert.match(result, /ADDITIVE VISUAL REFINEMENT/);
  assert.match(result, /must not override, reinterpret, or omit/i);
});

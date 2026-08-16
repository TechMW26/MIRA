import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeImage,
  buildVisionAnalysisPrompt,
  extractVisionSearchAnchor,
} from './imageAnalysis.js';

test('builds a bounded, evidence-focused vision prompt', () => {
  const prompt = buildVisionAnalysisPrompt('What device is this?', 0, 2);
  assert.match(prompt, /image 1 of 2/i);
  assert.match(prompt, /SEARCH_ANCHOR/);
  assert.match(prompt, /visible text\/OCR/i);
});

test('extracts only the explicit vision search anchor', () => {
  assert.equal(
    extractVisionSearchAnchor('SEARCH_ANCHOR: AlgaeTree installation\nVISUAL_ANALYSIS: Outdoor device'),
    'AlgaeTree installation',
  );
  assert.equal(extractVisionSearchAnchor('SEARCH_ANCHOR: NONE'), '');
});

test('routes image analysis to the dedicated endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ result: 'Visible details' }), { status: 200 });
  };
  try {
    const result = await analyzeImage('Describe this', 'YWJj', 'image/jpeg');
    assert.deepEqual(result, { result: 'Visible details' });
    assert.equal(request.url, '/api/analyze');
    assert.equal(request.body.images.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

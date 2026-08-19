import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTerminalLinks, normalizeLocalPreviewUrl } from './localPreview.js';

test('allows only local HTTP preview targets', () => {
  assert.equal(normalizeLocalPreviewUrl('localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(normalizeLocalPreviewUrl('http://0.0.0.0:5173'), 'http://localhost:5173/');
  assert.equal(normalizeLocalPreviewUrl('https://example.com'), '');
  assert.equal(normalizeLocalPreviewUrl('file:///etc/passwd'), '');
});

test('extracts clickable terminal links without trailing punctuation', () => {
  assert.deepEqual(extractTerminalLinks('Local: http://localhost:3000/\nDocs: https://example.com/docs.'), [
    'http://localhost:3000/',
    'https://example.com/docs',
  ]);
});

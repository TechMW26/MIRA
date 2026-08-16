import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getClipboardImageFiles,
  isSupportedImageUrl,
} from '../utils/imageFiles.js';

test('clipboard image extraction deduplicates file and item representations', () => {
  const image = { name: 'screenshot.png', type: 'image/png', size: 42, lastModified: 1 };
  const itemImage = { ...image, lastModified: 2 };
  const clipboard = {
    files: [image],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => itemImage }],
  };

  assert.deepEqual(getClipboardImageFiles(clipboard), [image]);
});

test('clipboard image extraction falls back to item files', () => {
  const image = { name: 'screenshot.png', type: 'image/png', size: 42, lastModified: 1 };
  const clipboard = {
    files: [],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
  };

  assert.deepEqual(getClipboardImageFiles(clipboard), [image]);
});

test('clipboard image extraction ignores non-image files', () => {
  const text = { name: 'notes.txt', type: 'text/plain', size: 12, lastModified: 1 };
  assert.deepEqual(getClipboardImageFiles({ files: [text], items: [] }), []);
});

test('copied image URL detection accepts image data and file URLs only', () => {
  assert.equal(isSupportedImageUrl('data:image/png;base64,AAAA'), true);
  assert.equal(isSupportedImageUrl('https://example.com/photo.webp?size=large'), true);
  assert.equal(isSupportedImageUrl('https://example.com/page'), false);
});

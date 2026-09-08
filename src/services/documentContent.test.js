import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectDocumentRequest,
  sanitizeDocumentContent,
} from '../utils/documentContent.js';

test('document intent detection stays lightweight and requires an explicit export action', () => {
  assert.equal(detectDocumentRequest('Create this as a PDF'), 'pdf');
  assert.equal(detectDocumentRequest('Export a Word document'), 'docx');
  assert.equal(detectDocumentRequest('Make a PowerPoint presentation'), 'pptx');
  assert.equal(detectDocumentRequest('Explain what a PDF is'), null);
});

test('document sanitization removes conversational and fake-download wrappers', () => {
  const source = [
    'Sure, here is the document:',
    '',
    '# Quarterly Report',
    '',
    '[Download Button]',
    '',
    'Revenue increased by 12%.',
  ].join('\n');
  assert.equal(
    sanitizeDocumentContent(source),
    '# Quarterly Report\n\nRevenue increased by 12%.',
  );
});

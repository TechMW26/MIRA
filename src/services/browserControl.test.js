import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBrowserRequest,
  isPotentialBrowserControl,
  stripBrowserControl,
} from './browserControl.js';

test('extracts a JSON Chrome MCP browser request', () => {
  assert.deepEqual(
    extractBrowserRequest('[MIRA_BROWSER: {"url":"https://example.com/docs","task":"Map the navigation"}]'),
    { url: 'https://example.com/docs', task: 'Map the navigation' },
  );
});

test('rejects non-http browser targets', () => {
  assert.equal(
    extractBrowserRequest('[MIRA_BROWSER: {"url":"file:///etc/passwd","task":"Read it"}]'),
    null,
  );
});

test('hides partial and completed browser control signals', () => {
  assert.equal(isPotentialBrowserControl('[MIRA_BROWSER: {"url":"https://example.com"'), true);
  assert.equal(stripBrowserControl('[MIRA_BROWSER: {"url":"https://example.com"'), '');
  assert.equal(
    stripBrowserControl('Before [MIRA_BROWSER: https://example.com | Inspect the DOM] After'),
    'Before  After',
  );
});

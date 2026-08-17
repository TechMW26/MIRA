import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchToolGuidance, decideRetrievalPolicy } from './retrievalPolicy.js';

test('current facts prioritize model-initiated search without host prefetch', () => {
  assert.deepEqual(decideRetrievalPolicy({ engineNeedsSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: true,
    searchPriority: true,
  });
});

test('explicit media needs prioritize the model search tool', () => {
  assert.deepEqual(decideRetrievalPolicy({ mediaRequested: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: true,
    searchPriority: true,
  });
  assert.deepEqual(decideRetrievalPolicy({ visualSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: true,
    searchPriority: true,
  });
  assert.deepEqual(decideRetrievalPolicy({ engineNeedsSearch: true, contextualMedia: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: true,
    searchPriority: true,
  });
});

test('website inspection and greetings bypass generic retrieval', () => {
  assert.deepEqual(decideRetrievalPolicy({ websiteInspection: true, manualSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: false,
    searchPriority: false,
  });
  assert.deepEqual(decideRetrievalPolicy({ simpleGreeting: true, engineNeedsSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: false,
    searchPriority: false,
  });
  assert.deepEqual(decideRetrievalPolicy({ simpleGreeting: true, manualSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: false,
    searchPriority: false,
  });
});

test('manual web mode tells the model to search instead of prefetching', () => {
  assert.deepEqual(decideRetrievalPolicy({ manualSearch: true }), {
    search: false,
    includeMedia: false,
    allowSearchTool: true,
    searchPriority: true,
  });
});

test('self-contained attachments disable search despite unrelated router signals', () => {
  assert.deepEqual(decideRetrievalPolicy({
    hasAuthoritativeContext: true,
    engineNeedsSearch: true,
    contextualSearch: true,
  }), {
    search: false,
    includeMedia: false,
    allowSearchTool: false,
    searchPriority: false,
  });
  assert.equal(buildSearchToolGuidance({ allowSearchTool: false }).includes('Do not search'), true);
});

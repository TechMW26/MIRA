import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWebsiteInspectionRequest,
  extractToolCall,
  isPotentialToolControl,
  stripToolControl,
  TOOL_NAMES,
} from './toolControl.js';

test('parses nested structured tool safewords', () => {
  assert.deepEqual(
    extractToolCall('[MIRA_TOOL: {"name":"browser.inspect","arguments":{"url":"https://example.com","task":"Identify its stack"}}]'),
    {
      name: TOOL_NAMES.BROWSER_INSPECT,
      arguments: { url: 'https://example.com', task: 'Identify its stack' },
      raw: '[MIRA_TOOL: {"name":"browser.inspect","arguments":{"url":"https://example.com","task":"Identify its stack"}}]',
    },
  );
});

test('hides partial and complete tool safewords', () => {
  assert.equal(isPotentialToolControl('[MIRA_TOOL: {"name":"web.search"'), true);
  assert.equal(stripToolControl('Visible [MIRA_TOOL: {"name":"web.search"'), 'Visible');
  assert.equal(stripToolControl('Before [MIRA_TOOL: {"name":"calculator.evaluate","arguments":{"expression":"2+2"}}] After'), 'Before  After');
});

test('detects direct website inspection before generic web search', () => {
  const call = detectWebsiteInspectionRequest('Study https://zenovalifestyle.com/ and tell me its technology stack');
  assert.equal(call.name, TOOL_NAMES.BROWSER_INSPECT);
  assert.equal(call.arguments.url, 'https://zenovalifestyle.com/');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOllamaKeepAlive } from './ollamaConfig.js';

test('sends Ollama sentinel keep-alive values as numbers', () => {
  assert.equal(parseOllamaKeepAlive('-1'), -1);
  assert.equal(parseOllamaKeepAlive('0'), 0);
  assert.equal(parseOllamaKeepAlive('30m'), '30m');
  assert.equal(parseOllamaKeepAlive('', -1), -1);
});

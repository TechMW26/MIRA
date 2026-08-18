import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLine } from './commandLine.js';

test('parses an executable and quoted arguments without using a shell', () => {
  assert.deepEqual(parseCommandLine('npm test -- --grep "task runner"'), [
    'npm', 'test', '--', '--grep', 'task runner',
  ]);
});

test('rejects unmatched command quotes', () => {
  assert.throws(() => parseCommandLine('node "script.js'), /unmatched quote/i);
});

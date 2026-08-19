import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceMemoryPrompt } from './workspaceMemory.js';

test('workspace memory combines durable instructions with recent chats and changes', () => {
  const prompt = buildWorkspaceMemoryPrompt({
    instructions: '# Instructions\nUse pnpm and preserve the API contract.',
    events: [
      { type: 'chat', turnId: 'one', user: 'Where is auth?', assistant: 'Auth is in src/auth.js.' },
      { type: 'change', path: 'src/auth.js', at: 1 },
    ],
  });
  assert.match(prompt, /Use pnpm/);
  assert.match(prompt, /Where is auth/);
  assert.match(prompt, /src\/auth\.js/);
});

test('workspace memory removes duplicate persisted turns', () => {
  const prompt = buildWorkspaceMemoryPrompt({
    events: [
      { type: 'chat', turnId: 'same', user: 'old', assistant: 'old answer' },
      { type: 'chat', turnId: 'same', user: 'new', assistant: 'new answer' },
    ],
  });
  assert.doesNotMatch(prompt, /old answer/);
  assert.match(prompt, /new answer/);
});

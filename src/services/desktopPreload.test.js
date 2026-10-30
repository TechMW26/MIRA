import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preloadUrl = new URL('../../desktop/preload.cjs', import.meta.url);

test('sandboxed desktop preload has no unsupported relative requires', async () => {
  const source = await readFile(preloadUrl, 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.?\//);
  assert.match(source, /contextBridge\.exposeInMainWorld\(['"]miraDesktop['"]/);
});

test('desktop preload exposes the companion screen capture channel', async () => {
  const source = await readFile(preloadUrl, 'utf8');
  assert.match(source, /captureCompanionScreen:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]mira:companion-capture-screen['"]\)/);
});

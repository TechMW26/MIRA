import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production assets use a root base so nested chat routes can reload', () => {
  const viteConfig = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(viteConfig, /base:\s*['"]\/['"]/);
  assert.doesNotMatch(viteConfig, /base:\s*['"]\.\/['"]/);
  assert.match(html, /href="\/manifest\.webmanifest"/);
  assert.match(html, /src="\/src\/main\.jsx"/);
  assert.match(viteConfig, /cacheId:\s*['"]mira-v3['"]/);
  assert.match(viteConfig, /importScripts:\s*\[['"]\/pwa-cache-reset-v3\.js['"]\]/);
  assert.match(packageJson.scripts['desktop:build'], /vite build --base=\.\//);
  assert.match(packageJson.scripts['desktop:pack'], /vite build --base=\.\//);
});

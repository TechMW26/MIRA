import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('server watchdog restarts Ollama and pre-warms the configured model', () => {
  const watchdog = read('../../ops/ollama/ollama-watchdog.sh');
  assert.match(watchdog, /systemctl restart ollama\.service/);
  assert.match(watchdog, /api\/generate/);
  assert.match(watchdog, /keep_alive/);
});

test('systemd policy keeps Ollama resident and checks recovery every minute', () => {
  const override = read('../../ops/ollama/systemd/ollama-mira.conf');
  const timer = read('../../ops/ollama/systemd/mira-ollama-watchdog.timer');
  assert.match(override, /Restart=always/);
  assert.match(override, /OLLAMA_FLASH_ATTENTION=1/);
  assert.match(override, /OLLAMA_KEEP_ALIVE=-1/);
  assert.match(timer, /OnUnitActiveSec=60s/);
  assert.match(timer, /Persistent=true/);
});

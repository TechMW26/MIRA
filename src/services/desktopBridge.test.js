import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDesktopTool, getDesktopBridge } from './desktopBridge.js';

test('desktop bridge is absent in the web runtime', async () => {
  assert.equal(getDesktopBridge({ window: {} }), null);
  await assert.rejects(
    executeDesktopTool({ name: 'shell.run', arguments: { command: 'npm' } }, { window: {} }),
    /desktop application/i,
  );
});

test('desktop tool calls cross only the trusted preload bridge', async () => {
  const calls = [];
  const output = await executeDesktopTool(
    { name: 'git.status', arguments: {} },
    {
      window: {
        miraDesktop: {
          invokeTool: async (call) => {
            calls.push(call);
            return { ok: true, output: 'clean' };
          },
        },
      },
    },
  );
  assert.equal(output, 'clean');
  assert.deepEqual(calls, [{ name: 'git.status', arguments: {} }]);
});

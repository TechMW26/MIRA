import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CAPABILITIES,
  filterToolsForRuntime,
  getAgentRuntimeCapabilities,
  hasAgentCapability,
} from './agentCapabilities.js';

function tool(name) {
  return { type: 'function', function: { name } };
}

test('web runtime never advertises local-system capabilities', () => {
  const runtime = getAgentRuntimeCapabilities({ window: {} });
  assert.equal(runtime.runtime, 'web');
  assert.equal(hasAgentCapability(runtime, AGENT_CAPABILITIES.WEB_SEARCH), true);
  assert.equal(hasAgentCapability(runtime, AGENT_CAPABILITIES.SHELL_RUN), false);
});

test('desktop capabilities must be explicitly advertised by the trusted preload', () => {
  const runtime = getAgentRuntimeCapabilities({
    window: {
      miraDesktop: {
        platform: 'darwin',
        capabilities: [AGENT_CAPABILITIES.SHELL_RUN, 'unknown.root.tool'],
      },
    },
  });
  assert.equal(runtime.runtime, 'desktop');
  assert.equal(runtime.platform, 'darwin');
  assert.equal(hasAgentCapability(runtime, AGENT_CAPABILITIES.SHELL_RUN), true);
  assert.equal(hasAgentCapability(runtime, 'unknown.root.tool'), false);
});

test('tool filtering keeps local tools out of web model requests', () => {
  const tools = [tool(AGENT_CAPABILITIES.WEB_SEARCH), tool(AGENT_CAPABILITIES.SHELL_RUN)];
  const filtered = filterToolsForRuntime(tools, getAgentRuntimeCapabilities({ window: {} }));
  assert.deepEqual(filtered.map((entry) => entry.function.name), [AGENT_CAPABILITIES.WEB_SEARCH]);
});

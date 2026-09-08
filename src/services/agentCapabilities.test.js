import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CAPABILITIES,
  classifyDesktopWorkspaceRequest,
  extractWorkspaceFileReferences,
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

test('desktop workspace indexing is available only when the preload advertises it', () => {
  const runtime = getAgentRuntimeCapabilities({
    window: {
      miraDesktop: {
        platform: 'darwin',
        capabilities: [AGENT_CAPABILITIES.WORKSPACE_INDEX, AGENT_CAPABILITIES.WORKSPACE_SEARCH],
      },
    },
  });
  assert.equal(hasAgentCapability(runtime, AGENT_CAPABILITIES.WORKSPACE_INDEX), true);
  assert.equal(hasAgentCapability(runtime, AGENT_CAPABILITIES.WORKSPACE_SEARCH), true);
  assert.equal(hasAgentCapability(getAgentRuntimeCapabilities({ window: {} }), AGENT_CAPABILITIES.WORKSPACE_SEARCH), false);
});

test('tool filtering keeps local tools out of web model requests', () => {
  const tools = [tool(AGENT_CAPABILITIES.WEB_SEARCH), tool(AGENT_CAPABILITIES.SHELL_RUN)];
  const filtered = filterToolsForRuntime(tools, getAgentRuntimeCapabilities({ window: {} }));
  assert.deepEqual(filtered.map((entry) => entry.function.name), [AGENT_CAPABILITIES.WEB_SEARCH]);
});

test('desktop codebase requests are routed to the workspace agent with mutation intent', () => {
  const runtime = {
    runtime: 'desktop',
    capabilities: [AGENT_CAPABILITIES.FILE_LIST, AGENT_CAPABILITIES.FILE_WRITE],
  };
  assert.deepEqual(classifyDesktopWorkspaceRequest('Study this codebase please', runtime), {
    active: true,
    mutation: false,
    execution: false,
    serverStart: false,
  });
  assert.deepEqual(classifyDesktopWorkspaceRequest('Optimize and test this repository', runtime), {
    active: true,
    mutation: true,
    execution: true,
    serverStart: false,
  });
  assert.equal(classifyDesktopWorkspaceRequest('Refine the codebase and make it work in real', runtime).mutation, true);
  assert.equal(classifyDesktopWorkspaceRequest('Improve repository performance', runtime).mutation, true);
  assert.equal(classifyDesktopWorkspaceRequest('Run the lint command', runtime).execution, true);
  assert.equal(classifyDesktopWorkspaceRequest('Run the server please', runtime).serverStart, true);
  assert.equal(classifyDesktopWorkspaceRequest('Explain photosynthesis', runtime).active, false);
  assert.equal(classifyDesktopWorkspaceRequest('Study this codebase', { runtime: 'web', capabilities: [] }).active, false);
});

test('extracts explicit workspace files for deterministic inspection', () => {
  assert.deepEqual(
    extractWorkspaceFileReferences('Inspect package.json, vite.config.js and src/main.jsx before answering. Ignore https://example.com.'),
    ['package.json', 'vite.config.js', 'src/main.jsx'],
  );
});

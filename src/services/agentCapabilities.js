export const AGENT_CAPABILITIES = Object.freeze({
  WEB_SEARCH: 'web.search',
  BROWSER_INSPECT: 'browser.inspect',
  CALCULATOR: 'calculator.evaluate',
  WEATHER: 'weather.lookup',
  CURRENCY: 'currency.convert',
  CODE_BROWSER: 'code.run',
  TASK: 'task.run',
  IMAGE: 'image.generate',
  VIDEO: 'video.generate',
  FILE_READ: 'filesystem.read',
  FILE_LIST: 'filesystem.list',
  FILE_WRITE: 'filesystem.write',
  FILE_SEARCH: 'filesystem.search',
  SHELL_RUN: 'shell.run',
  TEST_RUN: 'test.run',
  GIT_STATUS: 'git.status',
  GIT_DIFF: 'git.diff',
});

export const DESKTOP_AGENT_CAPABILITIES = Object.freeze([
  AGENT_CAPABILITIES.FILE_READ,
  AGENT_CAPABILITIES.FILE_LIST,
  AGENT_CAPABILITIES.FILE_WRITE,
  AGENT_CAPABILITIES.FILE_SEARCH,
  AGENT_CAPABILITIES.SHELL_RUN,
  AGENT_CAPABILITIES.TEST_RUN,
  AGENT_CAPABILITIES.GIT_STATUS,
  AGENT_CAPABILITIES.GIT_DIFF,
]);

const WEB_CAPABILITIES = Object.freeze([
  AGENT_CAPABILITIES.WEB_SEARCH,
  AGENT_CAPABILITIES.BROWSER_INSPECT,
  AGENT_CAPABILITIES.CALCULATOR,
  AGENT_CAPABILITIES.WEATHER,
  AGENT_CAPABILITIES.CURRENCY,
  AGENT_CAPABILITIES.CODE_BROWSER,
  AGENT_CAPABILITIES.TASK,
  AGENT_CAPABILITIES.IMAGE,
  AGENT_CAPABILITIES.VIDEO,
]);

export function getAgentRuntimeCapabilities(scope = globalThis) {
  const desktop = scope?.window?.miraDesktop;
  const advertised = Array.isArray(desktop?.capabilities)
    ? desktop.capabilities.filter((name) => DESKTOP_AGENT_CAPABILITIES.includes(name))
    : [];
  return Object.freeze({
    runtime: advertised.length ? 'desktop' : 'web',
    platform: desktop?.platform || 'web',
    capabilities: Object.freeze([...WEB_CAPABILITIES, ...advertised]),
  });
}

export function hasAgentCapability(runtime, capability) {
  return Array.isArray(runtime?.capabilities) && runtime.capabilities.includes(capability);
}

export function filterToolsForRuntime(tools = [], runtime = getAgentRuntimeCapabilities()) {
  return tools.filter((tool) => hasAgentCapability(runtime, tool?.function?.name));
}

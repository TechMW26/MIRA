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
  FILE_REPLACE: 'filesystem.replace',
  FILE_SEARCH: 'filesystem.search',
  FILE_PREVIEW: 'filesystem.preview',
  WORKSPACE_INDEX: 'workspace.index',
  WORKSPACE_SEARCH: 'workspace.search',
  WORKSPACE_VALIDATE: 'workspace.validate',
  WORKSPACE_START: 'workspace.start',
  SHELL_RUN: 'shell.run',
  SHELL_CANCEL: 'shell.cancel',
  TEST_RUN: 'test.run',
  GIT_STATUS: 'git.status',
  GIT_DIFF: 'git.diff',
  GIT_INFO: 'git.info',
  GIT_PULL: 'git.pull',
  GIT_PUSH: 'git.push',
  GIT_COMMIT: 'git.commit',
  GIT_REMOTE_SET: 'git.remote.set',
  CHANGE_LIST: 'change.list',
  CHANGE_UNDO: 'change.undo',
  CHANGE_REDO: 'change.redo',
  APPROVAL_STATUS: 'approval.status',
  APPROVAL_SET: 'approval.set',
});

export const DESKTOP_AGENT_CAPABILITIES = Object.freeze([
  AGENT_CAPABILITIES.FILE_READ,
  AGENT_CAPABILITIES.FILE_LIST,
  AGENT_CAPABILITIES.FILE_WRITE,
  AGENT_CAPABILITIES.FILE_REPLACE,
  AGENT_CAPABILITIES.FILE_SEARCH,
  AGENT_CAPABILITIES.FILE_PREVIEW,
  AGENT_CAPABILITIES.WORKSPACE_INDEX,
  AGENT_CAPABILITIES.WORKSPACE_SEARCH,
  AGENT_CAPABILITIES.WORKSPACE_VALIDATE,
  AGENT_CAPABILITIES.WORKSPACE_START,
  AGENT_CAPABILITIES.SHELL_RUN,
  AGENT_CAPABILITIES.SHELL_CANCEL,
  AGENT_CAPABILITIES.TEST_RUN,
  AGENT_CAPABILITIES.GIT_STATUS,
  AGENT_CAPABILITIES.GIT_DIFF,
  AGENT_CAPABILITIES.GIT_INFO,
  AGENT_CAPABILITIES.GIT_PULL,
  AGENT_CAPABILITIES.GIT_PUSH,
  AGENT_CAPABILITIES.GIT_COMMIT,
  AGENT_CAPABILITIES.GIT_REMOTE_SET,
  AGENT_CAPABILITIES.CHANGE_LIST,
  AGENT_CAPABILITIES.CHANGE_UNDO,
  AGENT_CAPABILITIES.CHANGE_REDO,
  AGENT_CAPABILITIES.APPROVAL_STATUS,
  AGENT_CAPABILITIES.APPROVAL_SET,
]);

const WORKSPACE_REQUEST_PATTERN = /\b(codebase|repository|repo|workspace|project files?|source code|code structure|implementation|implement|edit|modify|refactor|optim(?:ize|ise)|debug|fix|build|test|lint|run|terminal|git|github|commit|push|pull|branch|dependency|dependencies|package\.json)\b/i;
const WORKSPACE_MUTATION_PATTERN = /\b(implement|edit|modify|change|refactor|optim(?:ize|ise)|debug|fix|build|create|add|remove|rename|upgrade|migrate|install|write|apply|commit|push|pull)\b/i;
const WORKSPACE_EXECUTION_PATTERN = /\b(run|execute|test|lint|typecheck|check|build|compile|install|start|serve|deploy)\b/i;
const WORKSPACE_SERVER_START_PATTERN = /\b(?:run|start|launch|serve|boot)\b[^.\n]{0,40}\b(?:server|app|application|project|site|website|dev(?:elopment)?)\b|\b(?:server|app|application|project|site|website)\b[^.\n]{0,40}\b(?:run|start|launch|serve|boot)\b/i;
const WORKSPACE_FILE_REFERENCE_PATTERN = /(?:^|[\s("'`])((?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+\.(?:cjs|mjs|js|jsx|ts|tsx|json|css|scss|html|md|py|rb|go|rs|java|kt|swift|php|vue|svelte|yml|yaml|toml|xml|sql|sh|ps1))(?![\w./-])/gi;

export function extractWorkspaceFileReferences(text = '') {
  const references = [];
  for (const match of String(text || '').matchAll(WORKSPACE_FILE_REFERENCE_PATTERN)) {
    const value = String(match[1] || '').replace(/\\/g, '/');
    if (value && !references.includes(value)) references.push(value);
    if (references.length >= 12) break;
  }
  return references;
}

export function classifyDesktopWorkspaceRequest(text = '', runtime = getAgentRuntimeCapabilities()) {
  const value = String(text || '').trim();
  const desktop = runtime?.runtime === 'desktop'
    && hasAgentCapability(runtime, AGENT_CAPABILITIES.FILE_LIST);
  const active = Boolean(desktop && value && WORKSPACE_REQUEST_PATTERN.test(value));
  return Object.freeze({
    active,
    mutation: active && WORKSPACE_MUTATION_PATTERN.test(value),
    execution: active && WORKSPACE_EXECUTION_PATTERN.test(value),
    serverStart: active && WORKSPACE_SERVER_START_PATTERN.test(value),
  });
}

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

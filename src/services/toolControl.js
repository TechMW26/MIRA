export const TOOL_NAMES = Object.freeze({
  WEB_SEARCH: 'web.search',
  BROWSER_INSPECT: 'browser.inspect',
  CALCULATOR: 'calculator.evaluate',
  WEATHER: 'weather.lookup',
  CURRENCY: 'currency.convert',
  CODE: 'code.run',
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

const PREFIX = '[MIRA_TOOL:';

function parseBalancedJson(text, startIndex) {
  const objectStart = text.indexOf('{', startIndex);
  if (objectStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const closeBracket = text.indexOf(']', index + 1);
        if (closeBracket === -1) return null;
        return {
          json: text.slice(objectStart, index + 1),
          start: startIndex,
          end: closeBracket + 1,
        };
      }
    }
  }
  return null;
}

export function extractToolCall(text = '') {
  const value = String(text || '');
  const start = value.toUpperCase().indexOf(PREFIX);
  if (start === -1) return null;
  const balanced = parseBalancedJson(value, start);
  if (!balanced) return null;
  try {
    const payload = JSON.parse(balanced.json);
    const name = String(payload?.name || '').trim().toLowerCase();
    if (!Object.values(TOOL_NAMES).includes(name)) return null;
    return {
      name,
      arguments: payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {},
      raw: value.slice(balanced.start, balanced.end),
    };
  } catch {
    return null;
  }
}

export function isPotentialToolControl(text = '') {
  const value = String(text || '').trim();
  const start = value.toUpperCase().lastIndexOf(PREFIX);
  if (start === -1) return false;
  return !extractToolCall(value.slice(start)) || value.slice(start).includes(PREFIX);
}

export function stripToolControl(text = '') {
  let value = String(text || '');
  let call = extractToolCall(value);
  while (call) {
    value = value.replace(call.raw, '');
    call = extractToolCall(value);
  }
  const partial = value.toUpperCase().lastIndexOf(PREFIX);
  if (partial !== -1) value = value.slice(0, partial);
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

export function detectWebsiteInspectionRequest(text = '') {
  const value = String(text || '');
  const url = value.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0]?.replace(/[.,;!?]+$/, '');
  if (!url) return null;
  const inspectionIntent = /\b(study|inspect|crawl|audit|analy[sz]e|understand|open|visit|examine|review|check|map|document|source|dom|structure|stack|technology|technologies|framework|cms|hosting|backend|frontend|website)\b/i.test(value);
  if (!inspectionIntent) return null;
  return {
    name: TOOL_NAMES.BROWSER_INSPECT,
    arguments: {
      url,
      task: value.replace(url, '').replace(/\s+/g, ' ').trim() || 'Inspect and document this website.',
    },
  };
}

export function toLegacyBrowserRequest(call) {
  if (call?.name !== TOOL_NAMES.BROWSER_INSPECT) return null;
  const url = String(call.arguments?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    task: String(call.arguments?.task || 'Inspect and document this website.').trim(),
  };
}

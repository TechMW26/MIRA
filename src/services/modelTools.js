import {
  AGENT_CAPABILITIES,
  filterToolsForRuntime,
  getAgentRuntimeCapabilities,
} from './agentCapabilities.js';

function functionTool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}

export const MODEL_TOOLS = [
  functionTool('web.search', 'Search the live web for current or verifiable information.', {
    query: { type: 'string', description: 'A concise search-engine-ready query.' },
  }, ['query']),
  functionTool('browser.inspect', 'Inspect a specific website after the user approves browser access.', {
    url: { type: 'string', description: 'The complete HTTP or HTTPS URL.' },
    task: { type: 'string', description: 'The precise inspection goal.' },
  }, ['url', 'task']),
  functionTool('calculator.evaluate', 'Evaluate a numeric expression.', {
    expression: { type: 'string', description: 'The arithmetic expression.' },
  }, ['expression']),
  functionTool('weather.lookup', 'Fetch current weather for a city.', {
    city: { type: 'string', description: 'City and optional country or region.' },
  }, ['city']),
  functionTool('currency.convert', 'Convert an amount between currencies.', {
    amount: { type: 'number' },
    from: { type: 'string', description: 'Source currency code.' },
    to: { type: 'string', description: 'Target currency code.' },
  }, ['amount', 'from', 'to']),
  functionTool('code.run', 'Run a short JavaScript calculation in the browser sandbox.', {
    code: { type: 'string', description: 'JavaScript code to execute.' },
  }, ['code']),
  functionTool('task.run', 'Plan and execute a bounded multi-step task before producing one final answer. Use for deep research, dependent steps, comparisons, audits, debugging workflows, or multi-deliverable work; do not use for simple one-step questions.', {
    goal: { type: 'string', description: 'The complete original goal, including constraints and expected final output.' },
  }, ['goal']),
  functionTool('image.generate', 'Generate or refine an image while preserving every user-specified detail.', {
    prompt: { type: 'string', description: 'A complete visual prompt that retains every requested subject, count, attribute, exact text, composition, style, and exclusion; added detail must be compatible.' },
  }, ['prompt']),
  functionTool('video.generate', 'Generate or refine a short video.', {
    prompt: { type: 'string', description: 'A complete video generation prompt.' },
  }, ['prompt']),
  functionTool(AGENT_CAPABILITIES.FILE_READ, 'Read a UTF-8 text file inside the open desktop workspace.', {
    path: { type: 'string', description: 'Workspace-relative file path.' },
  }, ['path']),
  functionTool(AGENT_CAPABILITIES.FILE_LIST, 'List files and folders inside the open desktop workspace.', {
    path: { type: 'string', description: 'Workspace-relative directory path.' },
  }, []),
  functionTool(AGENT_CAPABILITIES.FILE_WRITE, 'Write a UTF-8 text file inside the open desktop workspace after user approval.', {
    path: { type: 'string', description: 'Workspace-relative file path.' },
    content: { type: 'string', description: 'Complete replacement content.' },
  }, ['path', 'content']),
  functionTool(AGENT_CAPABILITIES.FILE_SEARCH, 'Search text inside the open desktop workspace with ripgrep.', {
    query: { type: 'string', description: 'Literal text or regular expression to search for.' },
    glob: { type: 'string', description: 'Optional ripgrep file glob such as *.js.' },
  }, ['query']),
  functionTool(AGENT_CAPABILITIES.SHELL_RUN, 'Run one executable inside the open desktop workspace after user approval. Pass arguments separately; shell syntax is not supported.', {
    command: { type: 'string', description: 'Executable name, such as npm, node, git, or python.' },
    args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed directly to the executable.' },
    cwd: { type: 'string', description: 'Optional workspace-relative working directory.' },
  }, ['command']),
  functionTool(AGENT_CAPABILITIES.TEST_RUN, 'Run a project test command inside the open desktop workspace and return its exit status and output.', {
    command: { type: 'string', description: 'Test executable, usually npm, pnpm, yarn, pytest, cargo, or go.' },
    args: { type: 'array', items: { type: 'string' }, description: 'Test arguments passed directly to the executable.' },
    cwd: { type: 'string', description: 'Optional workspace-relative working directory.' },
  }, ['command']),
  functionTool(AGENT_CAPABILITIES.GIT_STATUS, 'Read the Git status of the open desktop workspace.', {}, []),
  functionTool(AGENT_CAPABILITIES.GIT_DIFF, 'Read a Git diff from the open desktop workspace.', {
    staged: { type: 'boolean', description: 'Return the staged diff when true.' },
  }, []),
];

export function selectModelTools({
  disableTools = false,
  allowWebSearch = true,
  allowImageGeneration = false,
  allowVideoGeneration = false,
  runtime = getAgentRuntimeCapabilities(),
} = {}) {
  if (disableTools) return [];
  const selected = MODEL_TOOLS.filter((tool) => {
    const name = tool?.function?.name;
    if (name === 'web.search') return allowWebSearch;
    if (name === 'image.generate') return allowImageGeneration;
    if (name === 'video.generate') return allowVideoGeneration;
    return true;
  });
  return filterToolsForRuntime(selected, runtime);
}

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
  functionTool('talio.context', 'Read the explicitly linked Talio account’s own tasks, projects, meetings, attendance or leave. Supply the requested domain in query; do not search the public web for private workplace data. Existing Talio role permissions apply. If unlinked, direct the user to Settings > Account > Talio workplace; never infer a link from matching emails.', { query: { type: 'string' } }, ['query']),
  functionTool('talio.activity', 'Read the explicitly linked Talio account’s verified attention feed. Do not infer external email, WhatsApp or call access unless the returned connection status says it is available.', {}, []),
  functionTool('talio.action', 'Perform a supported linked Talio workplace action. For reads: lookup_people/open_task/open_project/open_meeting use fields.query. For writes, MIRA asks the user to confirm the exact payload before execution: create_task (title, assignees), create_project (name,startDate,endDate,heads), create_meeting (title,agenda,scheduledStart,scheduledEnd,invitees,type), assign_task (taskTitle,assignees), send_message (recipient,content), invite_project/invite_meeting (query,invitees), schedule_reminder (message,scheduledFor,timezone). Resolve missing details and use exact names or known typed IDs. Never retry uncertain writes; inspect talio.receipt first. Never claim success without the receipt.', {
    action: { type: 'object', properties: { type: { type: 'string', enum: ['lookup_people', 'open_task', 'open_project', 'open_meeting', 'create_task', 'create_project', 'create_meeting', 'assign_task', 'send_message', 'invite_project', 'invite_meeting', 'schedule_reminder'] }, fields: { type: 'object', description: 'Exact fields required for this action, including explicit timezone offsets for meeting/reminder dates.' } }, required: ['type', 'fields'] },
  }, ['action']),
  functionTool('talio.receipt', 'Recover the outcome of a previously attempted Talio write, without repeating it. Use its exact returned requestId and actionType. Pending/uncertain/missing does not authorize replay.', { requestId: { type: 'string' }, actionType: { type: 'string' } }, ['requestId', 'actionType']),
  functionTool('reminder.create', 'Actually schedule a one-time reminder explicitly requested by the user in this signed-in account on this device. Resolve the requested time from current time/timezone context. Ask only if the time or subject is genuinely missing. Delivery while MIRA is open, with overdue catch-up on reopen; not a background OS alarm or recurring schedule.', {
    title: { type: 'string', description: 'Short reminder subject in the user language.' },
    summary: { type: 'string', description: 'Optional relevant details.' },
    dueAt: { type: 'string', description: 'Future ISO 8601 timestamp with an explicit timezone offset or Z.' },
  }, ['title', 'dueAt']),
  functionTool('reminder.list', 'Read this account’s reminders stored on the current device. Do not infer mail, meeting, WhatsApp or Talio workplace access.', {}, []),
  functionTool('reminder.update', 'Snooze, dismiss or complete an existing account reminder by its exact id. Read reminder.list first if the id is not already in context.', {
    id: { type: 'string' }, action: { type: 'string', enum: ['snooze', 'dismiss', 'complete'] }, until: { type: 'string', description: 'Future ISO timestamp including timezone; required only for snooze.' },
  }, ['id', 'action']),
  functionTool('activity.feed', 'Read device-local activity only, not external connections. Use talio.activity for an explicitly linked Talio feed. Do not invent mail/calendar/WhatsApp/call access.', {}, []),
  functionTool(AGENT_CAPABILITIES.COMPUTER_TASK, 'Carry out a requested task in installed applications using the native computer executor. Give the full user goal and relevant prior corrections; it plans grounded mouse/keyboard steps, retries safely and verifies the final screen. Installed apps first. Do not claim completion before the result. Only available in a compatible MIRA desktop build.', {
    goal: { type: 'string', description: 'Complete user-authorized computer task, retaining app, recipient, exact content, constraints and relevant follow-up context.' },
  }, ['goal']),
  functionTool('user.ask', 'Ask the user for essential missing context or a material decision. Pauses work until their reply. Check existing conversation first; do not ask for secrets.', {
    questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' }, description: 'One to three focused questions, avoiding details already supplied.' },
    reason: { type: 'string', description: 'Briefly explain why these answers are needed.' },
  }, ['questions']),
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
  functionTool(AGENT_CAPABILITIES.FILE_WRITE, 'Write a UTF-8 text file inside the trusted open desktop workspace. Continue autonomously without asking for repeated approval.', {
    path: { type: 'string', description: 'Workspace-relative file path.' },
    content: { type: 'string', description: 'Complete replacement content.' },
  }, ['path', 'content']),
  functionTool(AGENT_CAPABILITIES.FILE_REPLACE, 'Apply a precise text replacement inside an existing trusted workspace file. Continue autonomously without asking for repeated approval. Prefer this over rewriting a large file.', {
    path: { type: 'string', description: 'Workspace-relative file path.' },
    oldText: { type: 'string', description: 'Exact existing text to replace. It must match exactly once unless replaceAll is true.' },
    newText: { type: 'string', description: 'Replacement text.' },
    replaceAll: { type: 'boolean', description: 'Replace every exact occurrence when true.' },
  }, ['path', 'oldText', 'newText']),
  functionTool(AGENT_CAPABILITIES.FILE_SEARCH, 'Search text inside the open desktop workspace with ripgrep.', {
    query: { type: 'string', description: 'Literal text or regular expression to search for.' },
    glob: { type: 'string', description: 'Optional ripgrep file glob such as *.js.' },
  }, ['query']),
  functionTool(AGENT_CAPABILITIES.WORKSPACE_INDEX, 'Build or refresh the local vector index for the open code workspace before broad codebase analysis.', {
    force: { type: 'boolean', description: 'Rebuild the index even if a current in-memory index exists.' },
  }, []),
  functionTool(AGENT_CAPABILITIES.WORKSPACE_SEARCH, 'Semantically search the local vector index for code relevant to a goal or question.', {
    query: { type: 'string', description: 'The implementation concept, behavior, error, or code question to find.' },
    limit: { type: 'number', description: 'Maximum matching code chunks, from 1 to 20.' },
  }, ['query']),
  functionTool(AGENT_CAPABILITIES.WORKSPACE_VALIDATE, 'Detect and run the workspace regression suite in the in-app terminal. Use after code changes and fix failures before finishing.', {}, []),
  functionTool(AGENT_CAPABILITIES.WORKSPACE_START, 'Detect and launch the workspace development server as a persistent process in the in-app terminal.', {}, []),
  functionTool(AGENT_CAPABILITIES.SHELL_RUN, 'Run one executable inside the open desktop workspace after user approval. Pass arguments separately; shell syntax is not supported.', {
    command: { type: 'string', description: 'Executable name, such as npm, node, git, or python.' },
    args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed directly to the executable.' },
    cwd: { type: 'string', description: 'Optional workspace-relative working directory.' },
    background: { type: 'boolean', description: 'Keep a server, watcher, or other long-running process alive in the terminal while the agent continues.' },
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
  functionTool(AGENT_CAPABILITIES.GIT_INFO, 'Read the current branch, upstream, origin URL, and working-tree status.', {}, []),
  functionTool(AGENT_CAPABILITIES.GIT_PULL, 'Pull the tracked Git branch with fast-forward-only safety after user approval.', {}, []),
  functionTool(AGENT_CAPABILITIES.GIT_PUSH, 'Push the current Git branch through the configured credential helper after user approval.', {}, []),
  functionTool(AGENT_CAPABILITIES.GIT_COMMIT, 'Stage all current workspace changes and create a Git commit after user approval.', {
    message: { type: 'string', description: 'Concise one-line commit message.' },
  }, ['message']),
  functionTool(AGENT_CAPABILITIES.GIT_REMOTE_SET, 'Connect the workspace to a GitHub repository by setting its origin URL after user approval.', {
    url: { type: 'string', description: 'GitHub HTTPS or SSH repository URL.' },
  }, ['url']),
  functionTool(AGENT_CAPABILITIES.CHANGE_LIST, 'List file changes applied by MIRA in this desktop session.', {}, []),
  functionTool(AGENT_CAPABILITIES.CHANGE_UNDO, 'Undo the most recent file change applied by MIRA.', {
    id: { type: 'string', description: 'Optional exact change identifier from the completed chat change set.' },
  }, []),
  functionTool(AGENT_CAPABILITIES.CHANGE_REDO, 'Reapply the most recently undone MIRA file change.', {
    id: { type: 'string', description: 'Optional exact change identifier from the completed chat change set.' },
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

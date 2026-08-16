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
];

export function selectModelTools({
  disableTools = false,
  allowImageGeneration = false,
  allowVideoGeneration = false,
} = {}) {
  if (disableTools) return [];
  return MODEL_TOOLS.filter((tool) => {
    const name = tool?.function?.name;
    if (name === 'image.generate') return allowImageGeneration;
    if (name === 'video.generate') return allowVideoGeneration;
    return true;
  });
}

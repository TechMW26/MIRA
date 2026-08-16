// Native tool calls are disabled; the host handles supported control signals.
// Search and other capabilities are handled directly by the frontend pipeline.
export const MODEL_TOOLS = [];

const _UNUSED_MODEL_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web for current information such as news, products, documentation, people, or companies.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to run.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_expression',
      description: 'Evaluate a math or arithmetic expression.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'The arithmetic expression to evaluate.' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_javascript',
      description: 'Execute a short JavaScript snippet in the sandboxed code runner.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The JavaScript code to run.' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Fetch weather information for a city.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name to look up.' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convert_currency',
      description: 'Convert an amount from one currency into another.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Numeric amount to convert.' },
          from: { type: 'string', description: 'Source currency code, for example USD.' },
          to: { type: 'string', description: 'Target currency code, for example EUR.' },
        },
        required: ['amount', 'from', 'to'],
      },
    },
  },
]; // _UNUSED_MODEL_TOOLS_DEFINITIONS

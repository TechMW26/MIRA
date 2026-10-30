export const SCRIPT_NINJA_URL = 'https://scriptninja.pro/api/v1/chat/completions';
export const scriptNinjaConfigured = () => Boolean(String(process.env.SCRIPT_NINJA_KEY || '').trim());

export function resolveScriptNinjaModel(model) {
  return model === 'mira-pro' ? 'ninja-pro' : 'ninja-fast';
}

export async function requestScriptNinja({messages, tools = [], maxTokens, signal, model}) {
  const key = String(process.env.SCRIPT_NINJA_KEY || '').trim();
  if (!key) throw new Error('Script Ninja is not configured.');
  const timeout = AbortSignal.timeout(90_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const configuredLimit = Number(process.env.SCRIPT_NINJA_MAX_TOKENS || 8192);
  const limit = Number(maxTokens ?? configuredLimit);
  const response = await fetch(SCRIPT_NINJA_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    signal: requestSignal,
    body: JSON.stringify({
      model: resolveScriptNinjaModel(model),
      messages: tools.length ? [
        {role: 'system', content: `Available host tools (schemas only): ${JSON.stringify(tools)}. When a tool is needed, return exactly [MIRA_TOOL: {"name":"tool.name","arguments":{...}}] using a listed name and valid arguments. Do not claim execution before the host supplies results.`},
        ...messages,
      ] : messages,
      stream: false,
      max_tokens: Number.isSafeInteger(limit) && limit > 0 ? limit : 8192,
    }),
  });
  if (!response.ok) {
    // Never pass upstream bodies (which may echo credentials or user data) to clients.
    await response.body?.cancel().catch(() => {});
    const error = new Error(`The AI provider returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = 'mira_upstream_error';
    throw error;
  }
  let payload;
  try { payload = await response.json(); } catch {
    const error = new Error('The AI provider returned invalid JSON.');
    error.code = 'mira_invalid_response'; throw error;
  }
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (!message || (!String(message.content || '').trim() && !message.tool_calls?.length)) {
    const error = new Error('The AI provider returned an empty answer.');
    error.code = 'mira_empty_response'; throw error;
  }
  return {model: model === 'mira-pro' ? 'mira-pro' : 'mira-fast', message, done: true, done_reason: choice.finish_reason || 'stop'};
}

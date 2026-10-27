import { extractToolCall, stripToolControl } from './toolControl.js';

function fingerprint(call) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return `${call.name}:${JSON.stringify(stable(call.arguments || {}))}`;
}
const READ_TOOLS = new Set(['reminder.list', 'activity.feed', 'calculator.evaluate', 'weather.lookup', 'currency.convert', 'filesystem.read', 'filesystem.list', 'filesystem.search', 'git.status', 'git.diff']);
export function normalizeToolOutcome(call, value) {
  const result = typeof value === 'string' ? value : JSON.stringify(value);
  let payload = value;
  if (typeof value === 'string') { try { payload = JSON.parse(value); } catch { payload = null; } }
  const failed = payload && typeof payload === 'object' && !Array.isArray(payload)
    && (payload.success === false || payload.ok === false || payload.saved === false || payload.uncertain === true
      || ['error', 'failed', 'blocked', 'partial', 'uncertain'].includes(payload.status)
      || Number.isFinite(payload.exitCode) && payload.exitCode !== 0);
  const computerVerified = call.name !== 'computer.task' || /^Verified computer result:/.test(result);
  return { name: call.name, arguments: call.arguments, success: !failed && computerVerified, ...(payload?.uncertain ? { uncertain: true } : {}), result: result || '(No tool output)' };
}

// Sequential tool actions form a dependency chain: a later action only runs
// after the actual receipt of the previous one. Never replay an identical write
// merely because response synthesis retried or the model forgot its receipt.
export async function runToolOrchestration({ initialCall, initialResult, generate, execute, allowedTools, alive = () => true, maxCalls = 6 } = {}) {
  const check = () => { if (!alive()) throw Object.assign(new Error('The task was stopped.'), { name: 'AbortError' }); };
  const receipts = [normalizeToolOutcome(initialCall, initialResult)];
  const completed = new Set([fingerprint(initialCall)]);
  const readAttempts = new Map(READ_TOOLS.has(initialCall.name) ? [[fingerprint(initialCall), 1]] : []);
  for (let round = 0; round < maxCalls; round++) {
    check();
    const allowTools = round < maxCalls - 1;
    const response = String(await generate({ receipts, allowTools }) || '');
    check();
    const call = extractToolCall(response);
    if (!call) {
      const answer = stripToolControl(response).trim();
      if (!answer) throw new Error('The task finished without a usable answer.');
      return answer;
    }
    if (!allowTools || !allowedTools?.has(call.name)) throw new Error('The requested follow-up tool is unavailable or the task reached its operation limit. Results are not claimed complete.');
    const key = fingerprint(call);
    const readOnly = READ_TOOLS.has(call.name);
    if (completed.has(key) && (!readOnly || (readAttempts.get(key) || 0) >= 3)) {
      receipts.push({ name: call.name, success: false, result: 'This exact operation already has a receipt above. Do not repeat it; verify its outcome or report the actual result.' });
      continue;
    }
    check(); completed.add(key);
    if (readOnly) readAttempts.set(key, (readAttempts.get(key) || 0) + 1);
    try {
      const result = await execute(call);
      check(); receipts.push(normalizeToolOutcome(call, result));
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      receipts.push({ name: call.name, arguments: call.arguments, success: false, result: String(error.message).slice(0, 1000) });
    }
  }
  throw new Error('The task reached its operation limit. The full outcome is not verified complete.');
}

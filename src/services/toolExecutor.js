import { TOOL_NAMES } from './toolControl.js';
import { executeDesktopTool } from './desktopBridge.js';

function evaluateExpression(expression = '') {
  const value = String(expression || '').trim();
  if (!value || !/^[0-9+\-*/().%\s*]+$/.test(value)) {
    throw new Error('The calculator received an invalid expression.');
  }
  const result = Function(`"use strict"; return (${value});`)();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('The calculator result was not a finite number.');
  }
  return `Expression: ${value}\nResult: ${result}`;
}

async function executeJavaScript(code = '') {
  if (typeof Worker === 'undefined') throw new Error('The code sandbox is unavailable.');
  return await new Promise((resolve, reject) => {
    const workerSource = `
      self.onmessage = function(event) {
        const logs = [];
        const format = (value) => {
          try { return typeof value === 'string' ? value : JSON.stringify(value); }
          catch { return String(value); }
        };
        const console = {
          log: (...args) => logs.push(args.map(format).join(' ')),
          info: (...args) => logs.push(args.map(format).join(' ')),
          warn: (...args) => logs.push('WARN: ' + args.map(format).join(' ')),
          error: (...args) => logs.push('ERROR: ' + args.map(format).join(' ')),
        };
        try {
          const result = Function('console', '"use strict";\\n' + event.data)(console);
          self.postMessage({ logs, result: format(result) });
        } catch (error) {
          self.postMessage({ error: error && error.message ? error.message : String(error) });
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error('Code execution timed out.'));
    }, 3000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(`Output:\n${event.data?.logs?.join('\n') || '(no console output)'}${event.data?.result !== 'undefined' ? `\nReturn value: ${event.data.result}` : ''}`);
    };
    worker.onerror = (error) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(error?.message || 'Code execution failed.'));
    };
    worker.postMessage(String(code || ''));
  });
}

export async function executeHostTool(call, { runTask } = {}) {
  const args = call?.arguments || {};
  if (call?.name === TOOL_NAMES.CALCULATOR) {
    return evaluateExpression(args.expression);
  }
  if (call?.name === TOOL_NAMES.WEATHER) {
    const city = String(args.city || '').trim();
    if (!city) throw new Error('A city is required.');
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!response.ok) throw new Error(`Weather lookup failed (${response.status}).`);
    const payload = await response.json();
    const current = payload?.current_condition?.[0];
    const area = payload?.nearest_area?.[0];
    return [
      `Location: ${area?.areaName?.[0]?.value || city}, ${area?.country?.[0]?.value || ''}`,
      `Temperature: ${current?.temp_C}°C`,
      `Feels like: ${current?.FeelsLikeC}°C`,
      `Conditions: ${current?.weatherDesc?.[0]?.value || 'unknown'}`,
      `Humidity: ${current?.humidity}%`,
      `Wind: ${current?.windspeedKmph} km/h`,
    ].join('\n');
  }
  if (call?.name === TOOL_NAMES.CURRENCY) {
    const amount = Number(args.amount);
    const from = String(args.from || '').toUpperCase();
    const to = String(args.to || '').toUpperCase();
    if (!Number.isFinite(amount) || !from || !to) throw new Error('Amount, source currency, and target currency are required.');
    const response = await fetch(`https://api.frankfurter.app/latest?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!response.ok) throw new Error(`Currency conversion failed (${response.status}).`);
    const payload = await response.json();
    return `${amount} ${from} = ${payload?.rates?.[to]} ${to}\nRate date: ${payload?.date || 'unknown'}`;
  }
  if (call?.name === TOOL_NAMES.CODE) {
    return await executeJavaScript(args.code);
  }
  if (call?.name === TOOL_NAMES.TASK) {
    if (typeof runTask !== 'function') throw new Error('The task agent is unavailable.');
    return await runTask(String(args.goal || '').trim());
  }
  if ([
    TOOL_NAMES.FILE_READ,
    TOOL_NAMES.FILE_LIST,
    TOOL_NAMES.FILE_WRITE,
    TOOL_NAMES.FILE_REPLACE,
    TOOL_NAMES.FILE_SEARCH,
    TOOL_NAMES.WORKSPACE_INDEX,
    TOOL_NAMES.WORKSPACE_SEARCH,
    TOOL_NAMES.WORKSPACE_VALIDATE,
    TOOL_NAMES.WORKSPACE_START,
    TOOL_NAMES.SHELL_RUN,
    TOOL_NAMES.TEST_RUN,
    TOOL_NAMES.GIT_STATUS,
    TOOL_NAMES.GIT_DIFF,
    TOOL_NAMES.GIT_INFO,
    TOOL_NAMES.GIT_PULL,
    TOOL_NAMES.GIT_PUSH,
    TOOL_NAMES.GIT_COMMIT,
    TOOL_NAMES.GIT_REMOTE_SET,
    TOOL_NAMES.CHANGE_LIST,
    TOOL_NAMES.CHANGE_UNDO,
    TOOL_NAMES.CHANGE_REDO,
  ].includes(call?.name)) {
    return await executeDesktopTool(call);
  }
  throw new Error(`Unsupported host tool: ${call?.name || 'unknown'}`);
}

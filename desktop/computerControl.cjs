'use strict';
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { validateComputerAction, allowsNewTab, BROWSER_APP, channelContext } = require('./native/actionPlan.cjs');
const exec = promisify(execFile);
const PROTECTED = /terminal|iterm|powershell|command prompt|keychain|password|bitwarden|1password|system settings/i;

function sameWindow(a, b) {
  return a?.pid === b?.pid && a?.windowId === b?.windowId &&
    ['x', 'y', 'width', 'height'].every(k => Math.abs((a?.frame?.[k] || 0) - (b?.frame?.[k] || 0)) < 2);
}

function createComputerControl({ app, desktopCapturer, screen, dialog, systemPreferences, globalShortcut, runControl, platform = process.platform, now = Date.now }) {
  let session = null;
  let running = false;
  let timer;
  let consent = false;
  const shortcut = platform === 'darwin' ? 'CommandOrControl+Shift+Escape' : 'Control+Alt+Shift+Escape';
  const consentFile = path.join(app.getPath('userData'), 'computer-control-consent.json');
  const helper = path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'desktop/native/bin', `mira-control-${process.arch}`);
  const control = runControl || (async action => {
    if (platform !== 'darwin') throw new Error('General computer control currently needs the native macOS runtime. Browser and workspace tools remain available on this device.');
    const result = await exec(helper, [JSON.stringify(action)], { timeout: 12_000, maxBuffer: 3_000_000 });
    return JSON.parse(result.stdout);
  });
  const cancel = () => { session = null; clearTimeout(timer); globalShortcut.unregister(shortcut); return { success: true }; };
  const assertSession = id => {
    if (!session || session.id !== id || now() > session.expiresAt) { cancel(); throw new Error('Computer task stopped or expired.'); }
    return session;
  };
  async function begin(goal, window) {
    if (session) throw new Error('Another computer task is running. Stop it before starting a new one.');
    if (platform !== 'darwin' && !runControl) throw new Error('General computer control is available in the macOS build. Use existing browser/workspace tools on this device.');
    if (platform === 'darwin' && !runControl && Number.parseInt(os.release(), 10) < 23) throw new Error('General computer control requires macOS 14 or later. Browser and workspace tools remain available.');
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 3000) throw new Error('A complete computer task under 3000 characters is required.');
    if (platform === 'darwin' && (!systemPreferences.isTrustedAccessibilityClient(false) || systemPreferences.getMediaAccessStatus('screen') !== 'granted')) throw new Error('Enable MIRA Accessibility and Screen Recording in desktop setup, then retry.');
    if (!consent) {
      try { consent = JSON.parse(await fs.readFile(consentFile, 'utf8')).allowed === true; } catch {}
      if (!consent) {
        const answer = await dialog.showMessageBox(window, { type: 'question', title: 'MIRA computer control', message: 'Allow Mira to carry out your computer commands?', detail: `Mira can send screen captures to its configured vision provider and use the mouse and keyboard for tasks you request. Press ${shortcut} to stop. You can revoke access in MIRA settings.`, buttons: ['Not now', 'Allow'], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) throw new Error('Computer control was not approved.');
        consent = true; await fs.writeFile(consentFile, JSON.stringify({ allowed: true }), { mode: 0o600 });
      }
    }
    const state = await control({ type: 'status' });
    if (!state.success || state.accessibility === false) throw new Error(state.message || 'Native computer control is unavailable.');
    if (!globalShortcut.register(shortcut, cancel)) throw new Error('Emergency stop shortcut is unavailable.');
    session = { id: randomUUID(), goal: goal.trim(), expiresAt: now() + 300_000, steps: 0, observation: null };
    timer = setTimeout(cancel, 300_000); timer.unref?.();
    return { success: true, sessionId: session.id, stopShortcut: shortcut, platform };
  }
  async function observe(id) {
    const active = assertSession(id);
    const before = await control({ type: 'status' });
    if (!before.success) throw new Error(before.message || 'No foreground application.');
    const display = screen.getDisplayNearestPoint(before.center || screen.getCursorScreenPoint());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1440, height: 1000 }, fetchWindowIcons: false });
    const source = sources.find(s => String(s.display_id) === String(display.id)) || (sources.length === 1 ? sources[0] : null);
    if (!source || source.thumbnail.isEmpty()) throw new Error('The active screen could not be captured. Check Screen Recording and restart MIRA.');
    let targets = [];
    if (!PROTECTED.test(before.app || '')) {
      try {
        const ui = await control({ type: 'ui_elements' });
        if (ui.pid === before.pid) targets = (ui.elements || []).flatMap(e => {
          const f = e.frame;
          if (!f || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(f[k]))) return [];
          const x = (f.x + f.width / 2 - display.bounds.x) / display.bounds.width;
          const y = (f.y + f.height / 2 - display.bounds.y) / display.bounds.height;
          return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ role: String(e.role).slice(0, 50), label: String(e.label).slice(0, 120), x, y }] : [];
        }).slice(0, 60);
      } catch {}
    }
    const after = await control({ type: 'status' });
    if (!sameWindow(before, after)) return { success: false, retryable: true, message: 'The foreground window changed. Observe again.' };
    assertSession(id);
    const observation = { id: randomUUID(), at: now(), state: after, bounds: display.bounds, targets };
    active.observation = observation;
    return { success: true, observationId: observation.id, image: source.thumbnail.toJPEG(75).toString('base64'), mimeType: 'image/jpeg', app: after.app, targets, platform };
  }
  async function act(id, observationId, value) {
    const active = assertSession(id), seen = active.observation;
    const action = validateComputerAction(value);
    if (!action || ['create_file', 'reveal_file', 'lock'].includes(action.type)) throw new Error('Unsupported computer input. Use workspace tools for file operations.');
    if (!seen || seen.id !== observationId || now() - seen.at > 45_000) return { success: false, retryable: true, message: 'Observe the current screen before acting.' };
    if (active.steps >= 32) throw new Error('The computer task reached its input limit.');
    const state = await control({ type: 'status' });
    if (!sameWindow(seen.state, state) || Number.isFinite(state.keyIdleSeconds) && state.keyIdleSeconds < (now() - seen.at) / 1000 - .1) {
      active.observation = null; return { success: false, retryable: true, message: 'Desktop input or layout changed. Observe again; this input was not sent.' };
    }
    if (PROTECTED.test(state.app || '') && action.type !== 'open_app') throw new Error('This protected application needs manual control.');
    if (action.type !== 'open_app' && channelContext(active.goal, state.app, seen.targets).mismatch) throw new Error('The visible messaging channel does not match the requested channel. Observe and focus the correct application.');
    if ((action.type === 'key' && action.key === 'new_tab' || action.type === 'navigate' && action.newTab) && !allowsNewTab(active.goal)) throw new Error('Reuse the current tab; the user did not request a new tab.');
    const actions = action.type === 'navigate' ? [{ type: 'key', key: 'browser_address' }, { type: 'type', text: action.url }, { type: 'key', key: 'enter' }] : action.type === 'batch' ? action.actions : [action];
    if (active.steps + actions.length > 32) throw new Error('The computer task reached its input limit.');
    if (actions.some(a => a.type === 'key' && a.key === 'browser_address') && !BROWSER_APP.test(state.app || '')) throw new Error('Browser navigation requires a verified foreground browser.');
    if (action.type === 'batch' && actions[0].type === 'click' && !seen.targets.some(t => /TextField|TextArea|SearchField|textbox|combobox/i.test(t.role) && Math.abs(t.x - actions[0].x) < .025 && Math.abs(t.y - actions[0].y) < .025)) throw new Error('The batch must start at a verified editable field.');
    active.observation = null;
    const receipts = [];
    for (const input of actions) {
      assertSession(id);
      const converted = ['click', 'drag'].includes(input.type) ? { ...input, x: seen.bounds.x + input.x * seen.bounds.width, y: seen.bounds.y + input.y * seen.bounds.height,
        ...(input.type === 'drag' ? { toX: seen.bounds.x + input.toX * seen.bounds.width, toY: seen.bounds.y + input.toY * seen.bounds.height } : {}) } : input;
      const result = await control(converted); active.steps++;
      receipts.push(result);
      if (!result.success) return { success: false, message: result.message || 'Input failed.', receipts, uncertain: true };
    }
    return { success: true, receipts, requiresVerification: true };
  }
  async function handle(args = {}, window) {
    if (args.operation === 'cancel') { if (!args.sessionId || args.sessionId === session?.id) return cancel(); return { success: false }; }
    if (args.operation === 'revoke') { cancel(); consent = false; await fs.writeFile(consentFile, JSON.stringify({ allowed: false }), { mode: 0o600 }); return { success: true }; }
    if (running) throw new Error('A computer observation or input is already running.');
    running = true;
    try {
      if (args.operation === 'begin') return await begin(args.goal, window);
      if (args.operation === 'observe') return await observe(args.sessionId);
      if (args.operation === 'act') return await act(args.sessionId, args.observationId, args.action);
      if (args.operation === 'verify') {
        const active = assertSession(args.sessionId), seen = active.observation;
        const state = await control({ type: 'status' });
        const age = seen ? now() - seen.at : Infinity;
        return { success: Boolean(seen && seen.id === args.observationId && age < 45_000 && sameWindow(seen.state, state) && (!Number.isFinite(state.keyIdleSeconds) || state.keyIdleSeconds >= age / 1000 - .1)), verifiedAt: new Date(now()).toISOString() };
      }
      throw new Error('Unknown computer operation.');
    } finally { running = false; }
  }
  return { handle, cancel };
}
module.exports = { createComputerControl, sameWindow };

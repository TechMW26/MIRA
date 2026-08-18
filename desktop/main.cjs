const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const PRODUCTION_APP_URL = 'https://www.itsmira.cloud';
const DESKTOP_CAPABILITIES = Object.freeze([
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.search',
  'shell.run',
  'test.run',
  'git.status',
  'git.diff',
]);

let workspaceRoot = '';

function safeEnvironment() {
  const allowed = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|COOKIE|AUTH|API_KEY/i.test(key)) continue;
    allowed[key] = value;
  }
  return allowed;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function ensureWorkspace(window) {
  if (workspaceRoot) return workspaceRoot;
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a workspace for MIRA',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) throw new Error('No workspace was selected.');
  workspaceRoot = await fs.realpath(result.filePaths[0]);
  return workspaceRoot;
}

async function resolveWorkspacePath(window, input = '.') {
  const root = await ensureWorkspace(window);
  const value = String(input || '.');
  if (value.includes('\0') || path.isAbsolute(value)) {
    throw new Error('Only workspace-relative paths are allowed.');
  }
  const resolved = path.resolve(root, value);
  if (!isInside(root, resolved)) throw new Error('The requested path is outside the open workspace.');

  // Existing symlinks must not escape the workspace. For a new file, verify
  // the closest existing parent before allowing a write.
  let cursor = resolved;
  while (cursor !== root) {
    try {
      const real = await fs.realpath(cursor);
      if (!isInside(root, real)) throw new Error('The requested path leaves the workspace through a symlink.');
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      cursor = path.dirname(cursor);
    }
  }
  return resolved;
}

function normalizeProcessArgs(args) {
  if (args == null) return [];
  if (!Array.isArray(args) || args.length > 100) throw new Error('Command arguments must be an array of at most 100 strings.');
  return args.map((value) => {
    const item = String(value);
    if (item.length > 4096 || item.includes('\0')) throw new Error('A command argument is invalid.');
    return item;
  });
}

function normalizeExecutable(command) {
  const value = String(command || '').trim();
  if (!value || value.length > 512 || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error('A valid executable name is required.');
  }
  return value;
}

function commandPreview(command, args) {
  return [command, ...args].map((value) => (/^[\w@%+=:,./-]+$/.test(value) ? value : JSON.stringify(value))).join(' ');
}

function looksDestructive(command, args) {
  const preview = `${command} ${args.join(' ')}`.toLowerCase();
  return /(^|\s)(rm|rmdir|del|erase|format|mkfs|shutdown|reboot)(\s|$)/.test(preview)
    || /git\s+(reset\s+--hard|clean\s+-|push\s+.*--force)/.test(preview);
}

async function approve(window, title, detail, destructive = false) {
  const result = await dialog.showMessageBox(window, {
    type: destructive ? 'warning' : 'question',
    title,
    message: destructive ? 'MIRA is requesting a potentially destructive operation.' : 'MIRA is requesting permission.',
    detail,
    buttons: ['Cancel', 'Allow once'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result.response !== 1) throw new Error('The operation was not approved.');
}

async function runExecutable({ command, args = [], cwd = '.', timeout = PROCESS_TIMEOUT_MS }) {
  const executable = normalizeExecutable(command);
  const normalizedArgs = normalizeProcessArgs(args);
  const result = await execFileAsync(executable, normalizedArgs, {
    cwd,
    env: safeEnvironment(),
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
    shell: false,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return output || 'Command completed successfully.';
}

async function invokeDesktopTool(window, call = {}) {
  const name = String(call?.name || '');
  const args = call?.arguments && typeof call.arguments === 'object' ? call.arguments : {};
  if (!DESKTOP_CAPABILITIES.includes(name)) throw new Error('This desktop tool is not available.');

  if (name === 'filesystem.read') {
    const target = await resolveWorkspacePath(window, args.path);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('The requested file is not a readable text file under 2 MB.');
    return await fs.readFile(target, 'utf8');
  }

  if (name === 'filesystem.list') {
    const target = await resolveWorkspacePath(window, args.path || '.');
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) throw new Error('The requested path is not a directory.');
    const entries = await fs.readdir(target, { withFileTypes: true });
    const relativeBase = path.relative(workspaceRoot, target);
    return JSON.stringify(entries
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .slice(0, 500)
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(relativeBase.split(path.sep).join('/'), entry.name),
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)));
  }

  if (name === 'filesystem.write') {
    const target = await resolveWorkspacePath(window, args.path);
    const content = String(args.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Desktop writes are limited to 2 MB per file.');
    await approve(window, 'Allow file write?', `Write ${path.relative(workspaceRoot, target) || path.basename(target)}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return `Wrote ${path.relative(workspaceRoot, target)}.`;
  }

  if (name === 'filesystem.search') {
    const query = String(args.query || '').trim();
    if (!query || query.length > 1000) throw new Error('A valid search query is required.');
    const searchArgs = ['--line-number', '--color', 'never'];
    if (args.glob) searchArgs.push('--glob', String(args.glob).slice(0, 300));
    searchArgs.push('--', query, '.');
    try {
      return await runExecutable({ command: 'rg', args: searchArgs, cwd: await ensureWorkspace(window), timeout: 60_000 });
    } catch (error) {
      if (error?.code === 1) return 'No matches found.';
      throw error;
    }
  }

  if (name === 'git.status') {
    return await runExecutable({ command: 'git', args: ['status', '--short', '--branch'], cwd: await ensureWorkspace(window), timeout: 60_000 });
  }

  if (name === 'git.diff') {
    return await runExecutable({ command: 'git', args: ['diff', ...(args.staged ? ['--staged'] : [])], cwd: await ensureWorkspace(window), timeout: 60_000 });
  }

  if (name === 'shell.run' || name === 'test.run') {
    const command = normalizeExecutable(args.command);
    const processArgs = normalizeProcessArgs(args.args);
    const cwd = await resolveWorkspacePath(window, args.cwd || '.');
    const preview = commandPreview(command, processArgs);
    await approve(
      window,
      name === 'test.run' ? 'Allow test command?' : 'Allow command?',
      `${preview}\n\nWorking directory: ${path.relative(workspaceRoot, cwd) || '.'}`,
      looksDestructive(command, processArgs),
    );
    return await runExecutable({ command, args: processArgs, cwd });
  }

  throw new Error('Unsupported desktop operation.');
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#02070b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.argv.includes('--dev')
      ? url.startsWith('http://127.0.0.1:3000')
      : url.startsWith(PRODUCTION_APP_URL);
    if (!allowed) event.preventDefault();
  });

  if (process.argv.includes('--dev')) window.loadURL('http://127.0.0.1:3000');
  else window.loadURL(PRODUCTION_APP_URL);
  window.once('ready-to-show', () => window.show());
  return window;
}

app.whenReady().then(() => {
  const window = createWindow();
  ipcMain.handle('mira:runtime-info', () => ({
    platform: process.platform,
    capabilities: DESKTOP_CAPABILITIES,
    workspace: workspaceRoot || null,
  }));
  ipcMain.handle('mira:choose-workspace', async () => {
    workspaceRoot = '';
    return { workspace: await ensureWorkspace(window) };
  });
  ipcMain.handle('mira:invoke-tool', async (_event, call) => {
    try {
      return { ok: true, output: await invokeDesktopTool(window, call) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Desktop operation failed.' };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

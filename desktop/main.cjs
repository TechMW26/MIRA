const { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 40 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const PRODUCTION_APP_URL = 'https://www.itsmira.cloud';
const PERMISSION_BRIDGE_VERSION = 8;
const WORKSPACE_MEMORY_DIRECTORY = '.mira';
const WORKSPACE_INSTRUCTIONS_FILE = 'MIRA.md';
const WORKSPACE_HISTORY_FILE = 'history.jsonl';
const MAX_WORKSPACE_MEMORY_BYTES = 2 * 1024 * 1024;
const DESKTOP_CAPABILITIES = Object.freeze([
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.replace',
  'filesystem.search',
  'filesystem.preview',
  'workspace.index',
  'workspace.search',
  'workspace.validate',
  'workspace.start',
  'shell.run',
  'shell.cancel',
  'test.run',
  'git.status',
  'git.diff',
  'git.info',
  'git.pull',
  'git.push',
  'git.commit',
  'git.remote.set',
  'change.list',
  'change.undo',
  'change.redo',
  'approval.status',
  'approval.set',
]);

let workspaceRoot = '';
let desktopEnvironmentPromise = null;
let workspaceCommandTrust = false;
let workspaceVectorIndex = null;
const appliedChanges = [];
const undoneChanges = [];
const runningProcesses = new Map();

function workspaceStatePath() {
  return path.join(app.getPath('userData'), 'workspace-state.json');
}

async function rememberWorkspace(root) {
  await fs.mkdir(path.dirname(workspaceStatePath()), { recursive: true });
  await fs.writeFile(workspaceStatePath(), JSON.stringify({ root }), 'utf8');
}

async function restoreWorkspace() {
  try {
    const stored = JSON.parse(await fs.readFile(workspaceStatePath(), 'utf8'));
    const root = await fs.realpath(String(stored?.root || ''));
    const stat = await fs.stat(root);
    if (stat.isDirectory()) workspaceRoot = root;
  } catch {
    workspaceRoot = '';
  }
}

function getSystemPermissionStatus() {
  if (process.platform === 'darwin') {
    return {
      available: true,
      bridgeVersion: PERMISSION_BRIDGE_VERSION,
      platform: 'darwin',
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      fullDiskAccess: 'managed-in-system-settings',
    };
  }
  return {
    available: true,
    bridgeVersion: PERMISSION_BRIDGE_VERSION,
    platform: process.platform,
    accessibility: 'not-required',
    fullDiskAccess: process.platform === 'win32' ? 'managed-in-system-settings' : 'not-required',
  };
}

async function requestSystemPermission(permission) {
  if (permission === 'accessibility') {
    if (process.platform !== 'darwin') return getSystemPermissionStatus();
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
    return { ...getSystemPermissionStatus(), settingsOpened: !trusted };
  }

  if (permission === 'full-disk-access') {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    } else if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-broadfilesystemaccess');
    }
    return getSystemPermissionStatus();
  }

  throw new Error('Unsupported system permission request.');
}

function safeEnvironment() {
  const allowed = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|COOKIE|AUTH|API_KEY/i.test(key)) continue;
    allowed[key] = value;
  }
  return allowed;
}

async function desktopEnvironment() {
  if (desktopEnvironmentPromise) return desktopEnvironmentPromise;
  desktopEnvironmentPromise = (async () => {
    const environment = safeEnvironment();
    if (process.platform !== 'darwin') return environment;
    try {
      const result = await execFileAsync('/bin/zsh', ['-ilc', 'printf %s "$PATH"'], {
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      const loginPath = String(result.stdout || '').trim();
      return loginPath ? { ...environment, PATH: loginPath } : environment;
    } catch {
      return environment;
    }
  })();
  return desktopEnvironmentPromise;
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
  await rememberWorkspace(workspaceRoot);
  return workspaceRoot;
}

function workspaceMemoryPaths() {
  const directory = path.join(workspaceRoot, WORKSPACE_MEMORY_DIRECTORY);
  return {
    directory,
    instructions: path.join(directory, WORKSPACE_INSTRUCTIONS_FILE),
    history: path.join(directory, WORKSPACE_HISTORY_FILE),
    gitignore: path.join(directory, '.gitignore'),
  };
}

async function ensureWorkspaceMemory() {
  if (!workspaceRoot) return null;
  const paths = workspaceMemoryPaths();
  await fs.mkdir(paths.directory, { recursive: true });
  try {
    await fs.access(paths.instructions);
  } catch {
    await fs.writeFile(paths.instructions, [
      '# MIRA workspace context',
      '',
      'Add durable project instructions, conventions, decisions, and constraints below.',
      'MIRA reads this file whenever this workspace is opened.',
      '',
      '## Instructions',
      '',
      '- Preserve existing project conventions.',
      '',
    ].join('\n'), 'utf8');
  }
  try {
    await fs.access(paths.gitignore);
  } catch {
    await fs.writeFile(paths.gitignore, `${WORKSPACE_HISTORY_FILE}\n`, 'utf8');
  }
  return paths;
}

async function readRecentWorkspaceEvents(historyPath) {
  try {
    const stat = await fs.stat(historyPath);
    if (!stat.isFile() || stat.size === 0) return [];
    const bytes = Math.min(stat.size, MAX_WORKSPACE_MEMORY_BYTES);
    const handle = await fs.open(historyPath, 'r');
    const buffer = Buffer.alloc(bytes);
    try {
      await handle.read(buffer, 0, bytes, stat.size - bytes);
    } finally {
      await handle.close();
    }
    const source = buffer.toString('utf8');
    const lines = source.split('\n');
    if (stat.size > bytes) lines.shift();
    return lines
      .filter(Boolean)
      .slice(-120)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function getWorkspaceMemory() {
  const paths = await ensureWorkspaceMemory();
  if (!paths) return null;
  const [instructions, events] = await Promise.all([
    fs.readFile(paths.instructions, 'utf8'),
    readRecentWorkspaceEvents(paths.history),
  ]);
  return {
    workspace: workspaceRoot,
    instructions,
    events,
    files: {
      instructions: `${WORKSPACE_MEMORY_DIRECTORY}/${WORKSPACE_INSTRUCTIONS_FILE}`,
      history: `${WORKSPACE_MEMORY_DIRECTORY}/${WORKSPACE_HISTORY_FILE}`,
    },
  };
}

function cleanWorkspaceMemoryText(value, limit = 24_000) {
  return String(value || '').replace(/\u0000/g, '').slice(0, limit);
}

async function appendWorkspaceEvent(event) {
  const paths = await ensureWorkspaceMemory();
  if (!paths) return;
  const payload = {
    ...event,
    at: Number(event?.at) || Date.now(),
  };
  if (payload.user != null) payload.user = cleanWorkspaceMemoryText(payload.user);
  if (payload.assistant != null) payload.assistant = cleanWorkspaceMemoryText(payload.assistant, 48_000);
  if (payload.path != null) payload.path = cleanWorkspaceMemoryText(payload.path, 2_000);
  await fs.appendFile(paths.history, `${JSON.stringify(payload)}\n`, 'utf8');
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

function isAllowedLocalPreviewUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function approve(window, title, detail, destructive = false, allowWorkspaceSession = false) {
  const buttons = allowWorkspaceSession && !destructive
    ? ['Cancel', 'Allow once', 'Allow for workspace session']
    : ['Cancel', 'Allow once'];
  const result = await dialog.showMessageBox(window, {
    type: destructive ? 'warning' : 'question',
    title,
    message: destructive ? 'MIRA is requesting a potentially destructive operation.' : 'MIRA is requesting permission.',
    detail,
    buttons,
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  if (result.response === 0) throw new Error('The operation was not approved.');
  return result.response === 2 ? 'workspace-session' : 'once';
}

const INDEXABLE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
  '.json', '.kt', '.kts', '.md', '.mjs', '.cjs', '.php', '.py', '.rb', '.rs', '.scss',
  '.sh', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml',
  '.yaml', '.yml',
]);
const INDEX_IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.output', '.turbo', '.vercel', 'build', 'coverage', 'dist',
  'node_modules', 'release', 'target', 'vendor',
]);
const INDEX_IGNORED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const EMBEDDING_DIMENSIONS = 384;
const MAX_INDEX_FILES = 2500;
const MAX_INDEX_CHUNKS = 6000;
const MAX_INDEX_FILE_BYTES = 512 * 1024;
const MAX_SEMANTIC_CHUNKS = 512;
const SEMANTIC_BATCH_SIZE = 32;

function codeAssistEndpoint() {
  return process.argv.includes('--dev')
    ? 'http://127.0.0.1:3002/api/code-assist'
    : `${PRODUCTION_APP_URL}/api/code-assist`;
}

async function requestSemanticEmbeddings(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(codeAssistEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'embedding', input }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload?.embeddings)) {
      throw new Error(payload?.error || `Embedding request failed (${response.status}).`);
    }
    return { embeddings: payload.embeddings, model: String(payload.model || 'default') };
  } finally {
    clearTimeout(timeout);
  }
}

function encodeVector(vector) {
  return Buffer.from(Int8Array.from(vector, (entry) => Math.max(-127, Math.min(127, Math.round(entry * 127))))).toString('base64');
}

function decodeVector(vector) {
  return Array.from(Buffer.from(vector, 'base64'), (entry) => (entry > 127 ? entry - 256 : entry) / 127);
}

async function attachSemanticEmbeddings(index) {
  if (!index?.chunks?.length) return index;
  const count = Math.min(index.chunks.length, MAX_SEMANTIC_CHUNKS);
  const selectedIndexes = Array.from({ length: count }, (_, position) => (
    Math.min(index.chunks.length - 1, Math.floor((position * index.chunks.length) / count))
  ));
  const batches = [];
  for (let start = 0; start < selectedIndexes.length; start += SEMANTIC_BATCH_SIZE) {
    batches.push(selectedIndexes.slice(start, start + SEMANTIC_BATCH_SIZE));
  }
  let model = '';
  let embedded = 0;
  let nextBatch = 0;
  let semanticUnavailable = false;
  const worker = async () => {
    while (!semanticUnavailable && nextBatch < batches.length) {
      const batch = batches[nextBatch++];
      try {
        const result = await requestSemanticEmbeddings(batch.map((chunkIndex) => {
          const chunk = index.chunks[chunkIndex];
          return `${chunk.path}\n${chunk.text.slice(0, 6_000)}`;
        }));
        model ||= result.model;
        result.embeddings.forEach((vector, position) => {
          if (!Array.isArray(vector)) return;
          index.chunks[batch[position]].semanticVector = vector;
          embedded += 1;
        });
      } catch {
        semanticUnavailable = true;
        // The deterministic local vector remains available offline.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, batches.length) }, () => worker()));
  index.semanticModel = model;
  index.semanticChunks = embedded;
  index.embeddingMode = embedded ? (embedded === index.chunks.length ? 'semantic' : 'hybrid') : 'local';
  return index;
}

async function persistWorkspaceIndex(cacheDirectory, cachePath, index) {
  try {
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({
      ...index,
      root: undefined,
      chunks: index.chunks.map((chunk) => ({
        ...chunk,
        vector: encodeVector(chunk.vector),
        semanticVector: chunk.semanticVector ? encodeVector(chunk.semanticVector) : undefined,
      })),
    }), 'utf8');
  } catch {}
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedLocalText(value = '') {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  const tokens = String(value).toLowerCase().match(/[a-z_$][\w$-]{1,}|\d+(?:\.\d+)?/g) || [];
  for (const token of tokens) {
    const tokenHash = hashToken(token);
    const index = tokenHash % EMBEDDING_DIMENSIONS;
    vector[index] += (tokenHash & 1) ? 1 : -1;
    if (token.length >= 5) {
      for (let offset = 0; offset <= token.length - 3; offset += 1) {
        const gramHash = hashToken(token.slice(offset, offset + 3));
        vector[gramHash % EMBEDDING_DIMENSIONS] += (gramHash & 1) ? 0.2 : -0.2;
      }
    }
  }
  let magnitude = 0;
  for (const entry of vector) magnitude += entry * entry;
  magnitude = Math.sqrt(magnitude) || 1;
  return Array.from(vector, (entry) => entry / magnitude);
}

function vectorSimilarity(left, right) {
  let score = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

async function collectIndexFiles(root) {
  const files = [];
  async function visit(directory) {
    if (files.length >= MAX_INDEX_FILES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!INDEX_IGNORED_DIRECTORIES.has(entry.name)) await visit(target);
        continue;
      }
      if (!entry.isFile() || INDEX_IGNORED_FILES.has(entry.name)) continue;
      if (!INDEXABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(target);
      if (stat.size <= MAX_INDEX_FILE_BYTES) files.push({ target, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  await visit(root);
  return files;
}

function chunkSource(relativePath, source) {
  const lines = String(source).split('\n');
  const chunks = [];
  for (let start = 0; start < lines.length && chunks.length < MAX_INDEX_CHUNKS; start += 80) {
    const text = lines.slice(start, start + 100).join('\n').slice(0, 12_000);
    if (!text.trim()) continue;
    chunks.push({
      path: relativePath,
      startLine: start + 1,
      endLine: Math.min(lines.length, start + 100),
      text,
      vector: embedLocalText(`${relativePath} ${relativePath} ${text}`),
    });
  }
  return chunks;
}

async function buildWorkspaceIndex(window, force = false) {
  const root = await ensureWorkspace(window);
  if (!force && workspaceVectorIndex?.root === root) return workspaceVectorIndex;
  const files = await collectIndexFiles(root);
  const fingerprint = crypto.createHash('sha256').update(files
    .map((file) => `${path.relative(root, file.target)}:${file.size}:${Math.round(file.mtimeMs)}`)
    .sort()
    .join('\n')).digest('hex');
  const cacheDirectory = path.join(app.getPath('userData'), 'workspace-indexes');
  const cachePath = path.join(cacheDirectory, `${crypto.createHash('sha256').update(root).digest('hex')}.json`);
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (cached?.fingerprint === fingerprint && Array.isArray(cached.chunks)) {
        workspaceVectorIndex = {
          ...cached,
          root,
          chunks: cached.chunks.map((chunk) => ({
            ...chunk,
            vector: decodeVector(chunk.vector),
            semanticVector: chunk.semanticVector ? decodeVector(chunk.semanticVector) : undefined,
          })),
        };
        if (!workspaceVectorIndex.semanticChunks) {
          await attachSemanticEmbeddings(workspaceVectorIndex);
          await persistWorkspaceIndex(cacheDirectory, cachePath, workspaceVectorIndex);
        }
        return workspaceVectorIndex;
      }
    } catch {}
  }
  const chunks = [];
  const extensions = {};
  let project = null;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    project = {
      name: String(manifest.name || path.basename(root)),
      scripts: Object.keys(manifest.scripts || {}).slice(0, 30),
      dependencies: [...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.devDependencies || {})].slice(0, 120),
    };
  } catch {}
  for (const file of files) {
    if (chunks.length >= MAX_INDEX_CHUNKS) break;
    const relativePath = path.relative(root, file.target).split(path.sep).join('/');
    const extension = path.extname(file.target).toLowerCase() || 'text';
    extensions[extension] = (extensions[extension] || 0) + 1;
    const source = await fs.readFile(file.target, 'utf8');
    chunks.push(...chunkSource(relativePath, source).slice(0, MAX_INDEX_CHUNKS - chunks.length));
  }
  workspaceVectorIndex = {
    root,
    fingerprint,
    createdAt: Date.now(),
    files: files.length,
    chunks,
    extensions,
    project,
  };
  await attachSemanticEmbeddings(workspaceVectorIndex);
  await persistWorkspaceIndex(cacheDirectory, cachePath, workspaceVectorIndex);
  return workspaceVectorIndex;
}

function workspaceIndexSummary(index) {
  const languages = Object.entries(index.extensions)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([extension, count]) => `${extension}:${count}`);
  return {
    indexedFiles: index.files,
    indexedChunks: index.chunks.length,
    embedding: index.embeddingMode === 'semantic'
      ? `semantic-${index.semanticModel || 'managed'}-${EMBEDDING_DIMENSIONS}d`
      : index.embeddingMode === 'hybrid'
        ? `hybrid-semantic-local-${EMBEDDING_DIMENSIONS}d`
        : `local-feature-vector-${EMBEDDING_DIMENSIONS}d`,
    semanticChunks: Number(index.semanticChunks || 0),
    embeddingMode: index.embeddingMode || 'local',
    languages,
    project: index.project,
    createdAt: new Date(index.createdAt).toISOString(),
  };
}

async function previewWorkspaceFile(window, relativePath) {
  const target = await resolveWorkspacePath(window, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_PREVIEW_BYTES) throw new Error('Preview files must be under 40 MB.');
  const extension = path.extname(target).toLowerCase();
  const mime = ({
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'model/obj', '.stl': 'model/stl',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  })[extension] || 'application/octet-stream';
  const kind = /^image\//.test(mime) ? 'image'
    : mime === 'application/pdf' ? 'pdf'
      : extension === '.docx' ? 'document'
        : /^model\//.test(mime) ? 'model'
          : /^video\//.test(mime) ? 'video'
            : /^audio\//.test(mime) ? 'audio'
              : 'binary';
  const buffer = await fs.readFile(target);
  return JSON.stringify({
    path: path.relative(workspaceRoot, target).split(path.sep).join('/'),
    name: path.basename(target),
    extension,
    kind,
    mime,
    size: stat.size,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
  });
}

async function runExecutable({ command, args = [], cwd = '.', timeout = PROCESS_TIMEOUT_MS }) {
  const executable = normalizeExecutable(command);
  const normalizedArgs = normalizeProcessArgs(args);
  try {
    const result = await execFileAsync(executable, normalizedArgs, {
      cwd,
      env: await desktopEnvironment(),
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return output || 'Command completed successfully.';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Executable "${executable}" was not found. Install it or add it to your login PATH, then restart MIRA.`);
    }
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    const wrapped = new Error(detail || error?.message || `Command failed: ${executable}`);
    wrapped.code = error?.code;
    wrapped.stdout = error?.stdout;
    wrapped.stderr = error?.stderr;
    throw wrapped;
  }
}

async function runExecutableStreaming({
  command,
  args = [],
  cwd = '.',
  timeout = PROCESS_TIMEOUT_MS,
  onOutput,
  requestId = '',
  environmentOverrides = {},
  retainRecentOutput = false,
}) {
  const executable = normalizeExecutable(command);
  const normalizedArgs = normalizeProcessArgs(args);
  const environment = await desktopEnvironment();
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, normalizedArgs, {
      cwd,
      env: { ...environment, ...environmentOverrides },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (requestId) runningProcesses.set(requestId, child);
    let output = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (requestId) runningProcesses.delete(requestId);
      if (error) reject(error);
      else resolve(output.trim() || 'Command completed successfully.');
    };
    const append = (chunk) => {
      const text = String(chunk || '');
      if (!text) return;
      output += text;
      onOutput?.(text);
      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        if (retainRecentOutput) output = output.slice(-Math.floor(MAX_OUTPUT_BYTES / 2));
        else {
          child.kill();
          finish(new Error('Command output exceeded the 2 MB safety limit.'));
        }
      }
    };
    const timer = timeout > 0 ? setTimeout(() => {
      child.kill();
      finish(new Error(`Command timed out after ${Math.round(timeout / 1000)} seconds.`));
    }, timeout) : null;
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      if (error?.code === 'ENOENT') finish(new Error(`Executable "${executable}" was not found. Install it or add it to your login PATH, then restart MIRA.`));
      else finish(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code === 0) finish();
      else {
        const error = new Error(output.trim() || `Command exited with code ${code ?? signal ?? 'unknown'}.`);
        error.code = code;
        finish(error);
      }
    });
  });
}

async function pathExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function detectWorkspaceValidationCommands(root) {
  const commands = [];
  if (await pathExists(path.join(root, '.git'))) {
    commands.push({ command: 'git', args: ['diff', '--check'], label: 'Git whitespace validation' });
  }
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const scripts = new Set(Object.keys(manifest.scripts || {}));
    const packageManager = await pathExists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : await pathExists(path.join(root, 'yarn.lock')) ? 'yarn'
        : 'npm';
    for (const script of ['typecheck', 'lint', 'test', 'build']) {
      if (scripts.has(script)) commands.push({
        command: packageManager,
        args: ['run', script],
        label: `${packageManager} ${script}`,
      });
    }
  } catch {}
  if (await pathExists(path.join(root, 'pyproject.toml'))
    || await pathExists(path.join(root, 'pytest.ini'))
    || await pathExists(path.join(root, 'setup.cfg'))) {
    commands.push({ command: 'python3', args: ['-m', 'pytest'], label: 'Python tests' });
  }
  if (await pathExists(path.join(root, 'Cargo.toml'))) {
    commands.push({ command: 'cargo', args: ['test'], label: 'Rust tests' });
  }
  if (await pathExists(path.join(root, 'go.mod'))) {
    commands.push({ command: 'go', args: ['test', './...'], label: 'Go tests' });
  }
  if (await pathExists(path.join(root, 'pom.xml'))) {
    commands.push({ command: 'mvn', args: ['test'], label: 'Maven tests' });
  }
  if (await pathExists(path.join(root, 'gradlew'))) {
    commands.push({ command: './gradlew', args: ['test'], label: 'Gradle tests' });
  }
  return commands.slice(0, 8);
}

async function detectWorkspaceStartCommand(root) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const scripts = new Set(Object.keys(manifest.scripts || {}));
    const script = ['dev', 'start', 'serve', 'preview'].find((candidate) => scripts.has(candidate));
    if (script) {
      const packageManager = await pathExists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
        : await pathExists(path.join(root, 'yarn.lock')) ? 'yarn'
          : 'npm';
      return { command: packageManager, args: ['run', script], label: `${packageManager} ${script}` };
    }
  } catch {}
  if (await pathExists(path.join(root, 'manage.py'))) {
    return { command: 'python3', args: ['manage.py', 'runserver'], label: 'Django development server' };
  }
  if (await pathExists(path.join(root, 'Cargo.toml'))) {
    return { command: 'cargo', args: ['run'], label: 'Cargo application' };
  }
  if (await pathExists(path.join(root, 'go.mod'))) {
    return { command: 'go', args: ['run', '.'], label: 'Go application' };
  }
  throw new Error('No development-server command was detected. Add a dev, start, serve, or preview script, or run an explicit terminal command.');
}

async function launchBackgroundCommand(window, {
  command,
  args,
  cwd,
  requestId,
  environmentOverrides = {},
}) {
  const preview = commandPreview(command, args);
  window.webContents.send('mira:terminal-output', {
    requestId,
    chunk: `$ ${preview}\n`,
    reset: false,
    agent: true,
  });
  let exited = false;
  let earlyFailure = null;
  const processPromise = runExecutableStreaming({
    command,
    args,
    cwd,
    requestId,
    timeout: 0,
    environmentOverrides,
    retainRecentOutput: true,
    onOutput: (chunk) => window.webContents.send('mira:terminal-output', {
      requestId,
      chunk,
      agent: true,
    }),
  });
  processPromise.then(() => {
    exited = true;
  }, (error) => {
    exited = true;
    earlyFailure = error;
    window.webContents.send('mira:terminal-output', {
      requestId,
      chunk: `\nProcess stopped: ${error?.message || 'Unknown command error.'}\n`,
      agent: true,
    });
  }).finally(() => {
    window.webContents.send('mira:terminal-output', {
      requestId,
      chunk: '',
      agent: true,
      done: true,
    });
  });
  await Promise.race([
    processPromise.then(() => undefined, () => undefined),
    new Promise((resolve) => setTimeout(resolve, 750)),
  ]);
  if (earlyFailure) throw earlyFailure;
  if (exited) throw new Error(`The server command exited before becoming ready: ${preview}`);
  return JSON.stringify({ started: true, requestId, command: preview, cwd: path.relative(workspaceRoot, cwd) || '.' });
}

async function readOptionalFile(target) {
  try {
    return { existed: true, content: await fs.readFile(target, 'utf8') };
  } catch (error) {
    if (error?.code === 'ENOENT') return { existed: false, content: '' };
    throw error;
  }
}

function summarizeChanges() {
  return JSON.stringify({
    applied: appliedChanges.map(({ id, path: filePath, timestamp }) => ({ id, path: filePath, timestamp })),
    redo: undoneChanges.map(({ id, path: filePath, timestamp }) => ({ id, path: filePath, timestamp })),
  });
}

async function applyJournalState(change, direction) {
  const useBefore = direction === 'undo';
  const shouldExist = useBefore ? change.beforeExisted : true;
  const content = useBefore ? change.before : change.after;
  if (shouldExist) {
    await fs.mkdir(path.dirname(change.target), { recursive: true });
    await fs.writeFile(change.target, content, 'utf8');
  } else {
    await fs.rm(change.target, { force: true });
  }
}

async function gitInfo(window) {
  const cwd = await ensureWorkspace(window);
  const read = async (args) => {
    try { return await runExecutable({ command: 'git', args, cwd, timeout: 60_000 }); }
    catch { return ''; }
  };
  const [branch, upstream, remote, status] = await Promise.all([
    read(['branch', '--show-current']),
    read(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    read(['remote', 'get-url', 'origin']),
    read(['status', '--short']),
  ]);
  return JSON.stringify({
    branch: branch === 'Command completed successfully.' ? '' : branch,
    upstream: upstream === 'Command completed successfully.' ? '' : upstream,
    remote: remote === 'Command completed successfully.' ? '' : remote,
    status: status === 'Command completed successfully.' ? '' : status,
  });
}

async function saveWorkspaceFile(window, requestedPath, requestedContent, source = 'editor') {
  const target = await resolveWorkspacePath(window, requestedPath);
  const content = String(requestedContent ?? '');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Desktop writes are limited to 2 MB per file.');
  const before = await readOptionalFile(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  const relativePath = path.relative(workspaceRoot, target);
  appliedChanges.push({
    id: `${Date.now()}:${relativePath}`,
    path: relativePath,
    target,
    before: before.content,
    beforeExisted: before.existed,
    after: content,
    timestamp: Date.now(),
  });
  if (appliedChanges.length > 50) appliedChanges.shift();
  undoneChanges.length = 0;
  workspaceVectorIndex = null;
  await appendWorkspaceEvent({ type: 'change', path: relativePath, source });
  return JSON.stringify({ changed: true, path: relativePath, undoAvailable: true });
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

  if (name === 'filesystem.preview') {
    return await previewWorkspaceFile(window, args.path);
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
    return await saveWorkspaceFile(window, args.path, content, 'agent');
  }

  if (name === 'filesystem.replace') {
    const target = await resolveWorkspacePath(window, args.path);
    const oldText = String(args.oldText ?? '');
    const newText = String(args.newText ?? '');
    if (!oldText || Buffer.byteLength(oldText, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('A non-empty exact text match under 2 MB is required.');
    }
    const source = await fs.readFile(target, 'utf8');
    const occurrences = source.split(oldText).length - 1;
    if (occurrences === 0) throw new Error('The exact text to replace was not found. Read the latest file and try again.');
    if (!args.replaceAll && occurrences !== 1) {
      throw new Error(`The exact text occurs ${occurrences} times. Provide a more specific match or set replaceAll.`);
    }
    const content = args.replaceAll
      ? source.split(oldText).join(newText)
      : source.replace(oldText, newText);
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Desktop writes are limited to 2 MB per file.');
    await approve(window, 'Allow precise file edit?', `Edit ${path.relative(workspaceRoot, target) || path.basename(target)}`);
    return await saveWorkspaceFile(window, args.path, content, 'agent');
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

  if (name === 'workspace.index') {
    const index = await buildWorkspaceIndex(window, Boolean(args.force));
    return JSON.stringify(workspaceIndexSummary(index));
  }

  if (name === 'workspace.search') {
    const query = String(args.query || '').trim();
    if (!query || query.length > 2000) throw new Error('A valid workspace search query is required.');
    const index = await buildWorkspaceIndex(window, false);
    const queryVector = embedLocalText(query);
    let semanticQueryVector = null;
    if (index.semanticChunks) {
      try {
        semanticQueryVector = (await requestSemanticEmbeddings([query])).embeddings[0] || null;
      } catch {}
    }
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
    const results = index.chunks
      .map((chunk) => ({
        ...chunk,
        score: semanticQueryVector && chunk.semanticVector
          ? vectorSimilarity(semanticQueryVector, chunk.semanticVector)
          : vectorSimilarity(queryVector, chunk.vector),
      }))
      .filter((chunk) => chunk.score > 0.01)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ vector: _vector, text, ...result }) => ({
        ...result,
        score: Number(result.score.toFixed(4)),
        excerpt: text.slice(0, 2400),
      }));
    return JSON.stringify({ query, ...workspaceIndexSummary(index), results });
  }

  if (name === 'workspace.start') {
    const cwd = await ensureWorkspace(window);
    const start = await detectWorkspaceStartCommand(cwd);
    const preview = commandPreview(start.command, start.args);
    if (!workspaceCommandTrust) {
      const approval = await approve(
        window,
        'Start workspace server?',
        `${preview}\n\nWorking directory: .`,
        false,
        true,
      );
      if (approval === 'workspace-session') workspaceCommandTrust = true;
    }
    const requestId = `agent:server:${Date.now()}`;
    return await launchBackgroundCommand(window, {
      command: start.command,
      args: start.args,
      cwd,
      requestId,
      environmentOverrides: { BROWSER: 'none', CI: '0' },
    });
  }

  if (name === 'workspace.validate') {
    const cwd = await ensureWorkspace(window);
    const commands = await detectWorkspaceValidationCommands(cwd);
    if (!commands.length) return JSON.stringify({ passed: true, commands: [], note: 'No automatic validation commands were detected.' });
    const previews = commands.map(({ command, args: commandArgs }) => commandPreview(command, commandArgs));
    if (!workspaceCommandTrust) {
      const approval = await approve(
        window,
        'Run workspace regression suite?',
        `${previews.join('\n')}\n\nWorking directory: .`,
        false,
        true,
      );
      if (approval === 'workspace-session') workspaceCommandTrust = true;
    }
    const requestId = `agent:validate:${Date.now()}`;
    const results = [];
    try {
      for (const validation of commands) {
        const preview = commandPreview(validation.command, validation.args);
        window.webContents.send('mira:terminal-output', {
          requestId,
          chunk: `$ ${preview}\n`,
          reset: false,
          agent: true,
        });
        try {
          const output = await runExecutableStreaming({
            command: validation.command,
            args: validation.args,
            cwd,
            requestId,
            environmentOverrides: { CI: '1' },
            onOutput: (chunk) => window.webContents.send('mira:terminal-output', {
              requestId,
              chunk,
              agent: true,
            }),
          });
          results.push({ command: preview, passed: true, output: output.slice(-8000) });
        } catch (error) {
          results.push({ command: preview, passed: false, output: String(error?.message || 'Validation failed.').slice(-8000) });
          const failure = new Error(`Regression command failed: ${preview}\n${error?.message || ''}`.trim());
          failure.results = results;
          throw failure;
        }
      }
      return JSON.stringify({ passed: true, commands: results });
    } finally {
      window.webContents.send('mira:terminal-output', {
        requestId,
        chunk: '',
        agent: true,
        done: true,
      });
    }
  }

  if (name === 'git.status') {
    return await runExecutable({ command: 'git', args: ['status', '--short', '--branch'], cwd: await ensureWorkspace(window), timeout: 60_000 });
  }

  if (name === 'git.diff') {
    return await runExecutable({ command: 'git', args: ['diff', ...(args.staged ? ['--staged'] : [])], cwd: await ensureWorkspace(window), timeout: 60_000 });
  }

  if (name === 'git.info') return await gitInfo(window);

  if (name === 'git.remote.set') {
    const url = String(args.url || '').trim();
    if (!/^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?|git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)$/.test(url)) {
      throw new Error('A valid GitHub HTTPS or SSH repository URL is required.');
    }
    const cwd = await ensureWorkspace(window);
    await approve(window, 'Connect GitHub repository?', `Set origin to ${url}`);
    try {
      await runExecutable({ command: 'git', args: ['rev-parse', '--is-inside-work-tree'], cwd, timeout: 60_000 });
    } catch {
      await runExecutable({ command: 'git', args: ['init'], cwd, timeout: 60_000 });
    }
    let hasOrigin = true;
    try { await runExecutable({ command: 'git', args: ['remote', 'get-url', 'origin'], cwd, timeout: 60_000 }); }
    catch { hasOrigin = false; }
    await runExecutable({ command: 'git', args: ['remote', hasOrigin ? 'set-url' : 'add', 'origin', url], cwd, timeout: 60_000 });
    return await gitInfo(window);
  }

  if (name === 'git.pull') {
    const cwd = await ensureWorkspace(window);
    await approve(window, 'Pull Git changes?', 'Run git pull --ff-only in the open workspace.');
    return await runExecutable({ command: 'git', args: ['pull', '--ff-only'], cwd, timeout: PROCESS_TIMEOUT_MS });
  }

  if (name === 'git.push') {
    const cwd = await ensureWorkspace(window);
    const info = JSON.parse(await gitInfo(window));
    if (!info.remote) throw new Error('Connect a GitHub origin before pushing.');
    if (!info.branch) throw new Error('Create or check out a branch before pushing.');
    await approve(window, 'Push Git changes?', `Push branch ${info.branch} to ${info.remote}`);
    const pushArgs = info.upstream ? ['push'] : ['push', '--set-upstream', 'origin', info.branch];
    return await runExecutable({ command: 'git', args: pushArgs, cwd, timeout: PROCESS_TIMEOUT_MS });
  }

  if (name === 'git.commit') {
    const message = String(args.message || '').trim();
    if (!message || message.length > 200 || /[\r\n]/.test(message)) {
      throw new Error('A one-line commit message between 1 and 200 characters is required.');
    }
    const cwd = await ensureWorkspace(window);
    await approve(window, 'Commit workspace changes?', `Stage all current workspace changes and commit them as:\n\n${message}`);
    await runExecutable({ command: 'git', args: ['add', '--all'], cwd, timeout: 60_000 });
    return await runExecutable({ command: 'git', args: ['commit', '-m', message], cwd, timeout: PROCESS_TIMEOUT_MS });
  }

  if (name === 'change.list') return summarizeChanges();

  if (name === 'approval.status') {
    return JSON.stringify({ workspaceCommandsTrusted: workspaceCommandTrust });
  }

  if (name === 'approval.set') {
    workspaceCommandTrust = Boolean(args.workspaceCommandsTrusted);
    return JSON.stringify({ workspaceCommandsTrusted: workspaceCommandTrust });
  }

  if (name === 'shell.cancel') {
    const requestId = String(args.requestId || '');
    const child = runningProcesses.get(requestId);
    if (!child) return 'No matching command is running.';
    child.kill();
    return 'Command stopped.';
  }

  if (name === 'change.undo' || name === 'change.redo') {
    const source = name === 'change.undo' ? appliedChanges : undoneChanges;
    const destination = name === 'change.undo' ? undoneChanges : appliedChanges;
    const change = source[source.length - 1];
    if (!change) throw new Error(name === 'change.undo' ? 'There are no MIRA changes to undo.' : 'There are no MIRA changes to redo.');
    await approve(window, name === 'change.undo' ? 'Undo MIRA change?' : 'Redo MIRA change?', `${name === 'change.undo' ? 'Restore' : 'Reapply'} ${change.path}`);
    source.pop();
    await applyJournalState(change, name === 'change.undo' ? 'undo' : 'redo');
    workspaceVectorIndex = null;
    destination.push(change);
    return JSON.stringify({ changed: true, path: change.path, action: name === 'change.undo' ? 'undone' : 'redone' });
  }

  if (name === 'shell.run' || name === 'test.run') {
    const command = normalizeExecutable(args.command);
    const processArgs = normalizeProcessArgs(args.args);
    const cwd = await resolveWorkspacePath(window, args.cwd || '.');
    const preview = commandPreview(command, processArgs);
    const destructive = looksDestructive(command, processArgs);
    if (!workspaceCommandTrust || destructive) {
      const approval = await approve(
        window,
        name === 'test.run' ? 'Allow test command?' : 'Allow command?',
        `${preview}\n\nWorking directory: ${path.relative(workspaceRoot, cwd) || '.'}`,
        destructive,
        true,
      );
      if (approval === 'workspace-session') workspaceCommandTrust = true;
    }
    const requestedId = /^[A-Za-z0-9:_-]{1,100}$/.test(String(args.requestId || ''))
      ? String(args.requestId)
      : '';
    const requestId = requestedId || `agent:${Date.now()}`;
    if (name === 'shell.run' && args.background) {
      return await launchBackgroundCommand(window, {
        command,
        args: processArgs,
        cwd,
        requestId,
        environmentOverrides: { BROWSER: 'none', CI: '0' },
      });
    }
    if (!requestedId) {
      window.webContents.send('mira:terminal-output', { requestId, chunk: `$ ${preview}\n`, reset: false, agent: true });
    }
    try {
      return await runExecutableStreaming({
        command,
        args: processArgs,
        cwd,
        requestId,
        environmentOverrides: name === 'test.run' ? { CI: '1' } : {},
        onOutput: (chunk) => window.webContents.send('mira:terminal-output', { requestId, chunk, agent: !requestedId }),
      });
    } finally {
      if (!requestedId) window.webContents.send('mira:terminal-output', { requestId, chunk: '', agent: true, done: true });
    }
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
      webviewTag: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('before-input-event', (event, input) => {
    const saveShortcut = input.type === 'keyDown'
      && String(input.key || '').toLowerCase() === 's'
      && (input.meta || input.control)
      && !input.alt;
    if (!saveShortcut) return;
    event.preventDefault();
    window.webContents.send('mira:save-current-file');
  });
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedLocalPreviewUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
  window.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedLocalPreviewUrl(url)) return { action: 'allow' };
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedLocalPreviewUrl(url)) event.preventDefault();
    });
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

app.whenReady().then(async () => {
  desktopEnvironment().catch(() => {});
  await restoreWorkspace();
  const window = createWindow();
  ipcMain.handle('mira:runtime-info', () => ({
    appVersion: app.getVersion(),
    permissionBridgeVersion: PERMISSION_BRIDGE_VERSION,
    platform: process.platform,
    capabilities: DESKTOP_CAPABILITIES,
    workspace: workspaceRoot || null,
  }));
  ipcMain.handle('mira:permission-status', () => getSystemPermissionStatus());
  ipcMain.handle('mira:request-permission', async (_event, permission) => (
    requestSystemPermission(String(permission || ''))
  ));
  ipcMain.handle('mira:choose-workspace', async () => {
    const previousWorkspace = workspaceRoot;
    workspaceRoot = '';
    workspaceCommandTrust = false;
    workspaceVectorIndex = null;
    appliedChanges.length = 0;
    undoneChanges.length = 0;
    try {
      return { workspace: await ensureWorkspace(window) };
    } catch (error) {
      workspaceRoot = previousWorkspace;
      throw error;
    }
  });
  ipcMain.handle('mira:workspace-memory', async () => getWorkspaceMemory());
  ipcMain.handle('mira:save-workspace-file', async (_event, payload) => {
    try {
      return {
        ok: true,
        output: await saveWorkspaceFile(window, payload?.path, payload?.content, 'editor'),
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not save the workspace file.' };
    }
  });
  ipcMain.handle('mira:append-workspace-turn', async (_event, turn) => {
    if (!workspaceRoot) return { saved: false };
    const value = turn && typeof turn === 'object' ? turn : {};
    await appendWorkspaceEvent({
      type: 'chat',
      conversationId: cleanWorkspaceMemoryText(value.conversationId, 300),
      turnId: cleanWorkspaceMemoryText(value.turnId, 300),
      user: value.user,
      assistant: value.assistant,
      attachments: Array.isArray(value.attachments)
        ? value.attachments.map((item) => cleanWorkspaceMemoryText(item, 500)).slice(0, 20)
        : [],
    });
    return { saved: true };
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

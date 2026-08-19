import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Code2,
  File,
  Folder,
  FolderOpen,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react';
import {
  chooseDesktopWorkspace,
  executeDesktopTool,
  getDesktopPermissionStatus,
  getDesktopRuntimeInfo,
  requestDesktopPermission,
} from '../../services/desktopBridge.js';
import { parseCommandLine } from '../../services/commandLine.js';

function parentPath(value = '') {
  const parts = String(value).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function languageFor(path = '') {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ js: 'JavaScript', jsx: 'React', ts: 'TypeScript', tsx: 'React TS', py: 'Python', css: 'CSS', html: 'HTML', json: 'JSON', md: 'Markdown' })[extension] || 'Text';
}

export default function DesktopWorkspace() {
  const [runtime, setRuntime] = useState(null);
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState([]);
  const [activeFile, setActiveFile] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [command, setCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState('Ready. Commands run without a shell and require approval.');
  const [commandRunning, setCommandRunning] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState('');
  const dirty = content !== savedContent;

  const loadDirectory = useCallback(async (path = '') => {
    setLoading(true);
    setError('');
    try {
      const output = await executeDesktopTool({ name: 'filesystem.list', arguments: { path: path || '.' } });
      setEntries(JSON.parse(output));
      setDirectory(path);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getDesktopRuntimeInfo().then((info) => {
      setRuntime(info);
      if (info?.workspace) loadDirectory('');
    }).catch(() => setRuntime(null));
    getDesktopPermissionStatus().then((status) => {
      setPermissionStatus(status);
      const introSeen = localStorage.getItem('mira-system-access-intro-v1') === 'seen';
      if (status?.platform === 'darwin' && !status.accessibility && !introSeen) {
        setShowPermissions(true);
      }
    }).catch(() => setPermissionStatus(null));
  }, [loadDirectory]);

  function closePermissions() {
    localStorage.setItem('mira-system-access-intro-v1', 'seen');
    setShowPermissions(false);
  }

  async function requestPermission(permission) {
    setPermissionBusy(permission);
    setError('');
    try {
      const next = await requestDesktopPermission(permission);
      setPermissionStatus(next);
    } catch (permissionError) {
      setError(permissionError?.message || 'Could not open system permissions.');
    } finally {
      setPermissionBusy('');
    }
  }

  const workspaceName = useMemo(() => {
    const path = String(runtime?.workspace || '').replace(/[\\/]+$/, '');
    return path.split(/[\\/]/).pop() || 'No workspace';
  }, [runtime?.workspace]);

  async function chooseWorkspace() {
    setError('');
    try {
      const next = await chooseDesktopWorkspace();
      setRuntime((current) => ({ ...(current || {}), workspace: next.workspace }));
      setActiveFile('');
      setContent('');
      setSavedContent('');
      await loadDirectory('');
    } catch (chooseError) {
      if (!/No workspace was selected/i.test(chooseError?.message || '')) {
        setError(chooseError?.message || 'Could not open that workspace.');
      }
    }
  }

  async function openEntry(entry) {
    if (entry.type === 'directory') {
      await loadDirectory(entry.path);
      return;
    }
    if (entry.type !== 'file') return;
    setLoading(true);
    setError('');
    try {
      const next = await executeDesktopTool({ name: 'filesystem.read', arguments: { path: entry.path } });
      setActiveFile(entry.path);
      setContent(next);
      setSavedContent(next);
    } catch (openError) {
      setError(openError?.message || 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  async function saveFile() {
    if (!activeFile || !dirty) return;
    setLoading(true);
    setError('');
    try {
      await executeDesktopTool({ name: 'filesystem.write', arguments: { path: activeFile, content } });
      setSavedContent(content);
    } catch (saveError) {
      setError(saveError?.message || 'Could not save that file.');
    } finally {
      setLoading(false);
    }
  }

  async function runCommand(event) {
    event?.preventDefault();
    if (!command.trim() || commandRunning) return;
    setCommandRunning(true);
    setError('');
    try {
      const [executable, ...args] = parseCommandLine(command);
      const output = await executeDesktopTool({
        name: 'shell.run',
        arguments: { command: executable, args, cwd: directory || '.' },
      });
      setTerminalOutput(`$ ${command}\n${output}`);
      setCommand('');
    } catch (commandError) {
      setTerminalOutput(`$ ${command}\nError: ${commandError?.message || 'Command failed.'}`);
    } finally {
      setCommandRunning(false);
    }
  }

  return (
    <section className="desktop-workspace" aria-label="MIRA workspace IDE">
      <header className="desktop-workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 size={16} />
          <strong className="truncate">{workspaceName}</strong>
          {activeFile && <span className="truncate text-[11px] opacity-60">/ {activeFile}{dirty ? ' •' : ''}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowPermissions(true)} className="desktop-ide-button" aria-label="Configure system access">
            <ShieldCheck size={13} /> System access
          </button>
          <button type="button" onClick={chooseWorkspace} className="desktop-ide-button">{runtime?.workspace ? 'Switch folder' : 'Open folder'}</button>
        </div>
      </header>

      <div className="desktop-workspace-body">
        <aside className="desktop-explorer" aria-label="File explorer">
          <div className="desktop-pane-title">
            <span>Explorer</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => loadDirectory(parentPath(directory))} disabled={!directory} aria-label="Parent folder"><ChevronLeft size={14} /></button>
              <button type="button" onClick={() => loadDirectory(directory)} disabled={!runtime?.workspace} aria-label="Refresh files"><RefreshCw size={13} /></button>
            </div>
          </div>
          <div className="desktop-path">/{directory}</div>
          <div className="desktop-file-list">
            {!runtime?.workspace && <button type="button" onClick={chooseWorkspace} className="desktop-empty-action"><FolderOpen size={18} />Choose a workspace</button>}
            {runtime?.workspace && !loading && entries.length === 0 && <p className="desktop-empty-copy">This folder is empty.</p>}
            {entries.map((entry) => (
              <button key={entry.path} type="button" onClick={() => openEntry(entry)} className={`desktop-file-row ${activeFile === entry.path ? 'active' : ''}`}>
                {entry.type === 'directory' ? <Folder size={14} /> : <File size={14} />}
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="desktop-editor-column">
          <div className="desktop-editor-toolbar">
            <span>{activeFile ? languageFor(activeFile) : 'Editor'}</span>
            <button type="button" onClick={saveFile} disabled={!dirty || loading} className="desktop-ide-button" aria-label="Save current file"><Save size={13} /> Save</button>
          </div>
          {activeFile ? (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  saveFile();
                }
              }}
              className="desktop-code-editor"
              spellCheck={false}
              aria-label={`Editing ${activeFile}`}
            />
          ) : (
            <div className="desktop-editor-empty"><Code2 size={28} /><p>Choose a file from Explorer to start editing.</p></div>
          )}

          <div className="desktop-terminal">
            <div className="desktop-pane-title"><span className="inline-flex items-center gap-2"><TerminalSquare size={14} />Terminal</span><span>{directory || '.'}</span></div>
            <pre>{terminalOutput}</pre>
            <form onSubmit={runCommand} className="desktop-terminal-input">
              <span>$</span>
              <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npm test" disabled={!runtime?.workspace || commandRunning} aria-label="Terminal command" />
              <button type="submit" disabled={!command.trim() || commandRunning} aria-label="Run command"><Play size={13} /></button>
            </form>
          </div>
        </div>
      </div>
      {error && <div className="desktop-workspace-error" role="alert">{error}</div>}
      {showPermissions && (
        <div className="desktop-permission-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-permission-title">
          <section className="desktop-permission-dialog">
            <div className="desktop-permission-heading">
              <div>
                <span className="desktop-permission-eyebrow">Desktop permissions</span>
                <h2 id="desktop-permission-title">Configure system access</h2>
              </div>
              <button type="button" onClick={closePermissions} aria-label="Close system access dialog"><X size={18} /></button>
            </div>
            <p>MIRA requests each macOS permission explicitly. File and command access remains limited to the workspace you select, and commands still require approval.</p>
            <div className="desktop-permission-list">
              <article>
                <div><strong>Accessibility</strong><span>Allows approved desktop automation.</span></div>
                <button type="button" onClick={() => requestPermission('accessibility')} disabled={permissionBusy === 'accessibility' || permissionStatus?.accessibility === true} className="desktop-ide-button">
                  {permissionStatus?.accessibility === true ? 'Allowed' : permissionBusy === 'accessibility' ? 'Requesting…' : 'Request access'}
                </button>
              </article>
              <article>
                <div><strong>Full Disk Access</strong><span>Lets selected workspaces include protected folders.</span></div>
                <button type="button" onClick={() => requestPermission('full-disk-access')} disabled={permissionBusy === 'full-disk-access'} className="desktop-ide-button">
                  {permissionBusy === 'full-disk-access' ? 'Opening…' : 'Open settings'}
                </button>
              </article>
            </div>
            {permissionStatus?.platform !== 'darwin' && (
              <p className="desktop-permission-note">Your operating system does not require macOS Accessibility permission. Workspace selection and per-command approval remain active.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

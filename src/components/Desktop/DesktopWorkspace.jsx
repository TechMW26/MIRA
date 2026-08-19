import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Code2,
  Copy,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  Github,
  Globe2,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
  Download,
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
import { extractTerminalLinks, normalizeLocalPreviewUrl } from '../../services/localPreview.js';
import TerminalOutput from './TerminalOutput.jsx';
import WorkspaceBrowser from './WorkspaceBrowser.jsx';
import WorkspaceCodeEditor from './WorkspaceCodeEditor.jsx';
import WorkspaceFilePreview from './WorkspaceFilePreview.jsx';

const PREVIEW_EXTENSIONS = new Set([
  'avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp', 'pdf', 'docx',
  'glb', 'gltf', 'obj', 'stl', 'mp4', 'webm', 'mp3', 'wav',
]);

function parentPath(value = '') {
  const parts = String(value).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function languageFor(path = '') {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ js: 'JavaScript', jsx: 'React', ts: 'TypeScript', tsx: 'React TS', py: 'Python', css: 'CSS', html: 'HTML', json: 'JSON', md: 'Markdown' })[extension] || 'Text';
}

export default function DesktopWorkspace({ style }) {
  const [runtime, setRuntime] = useState(null);
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState([]);
  const [activeFile, setActiveFile] = useState('');
  const [activePreview, setActivePreview] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [command, setCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState('Ready. Commands execute directly. You can trust this workspace for the current app session.');
  const [commandRunning, setCommandRunning] = useState(false);
  const [activeTerminalRequestId, setActiveTerminalRequestId] = useState('');
  const [terminalHeight, setTerminalHeight] = useState(() => Number(localStorage.getItem('mira_terminal_height')) || 210);
  const [explorerWidth, setExplorerWidth] = useState(() => Number(localStorage.getItem('mira_explorer_width')) || 220);
  const [workspaceCommandsTrusted, setWorkspaceCommandsTrusted] = useState(false);
  const [indexStatus, setIndexStatus] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const indexInFlightRef = useRef(false);
  const terminalRequestRef = useRef('');
  const terminalOutputRef = useRef(null);
  const commandHistoryRef = useRef([]);
  const commandHistoryIndexRef = useRef(0);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [permissionMessage, setPermissionMessage] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [gitInfo, setGitInfo] = useState({ branch: '', upstream: '', remote: '', status: '' });
  const [gitDiff, setGitDiff] = useState('');
  const [changeJournal, setChangeJournal] = useState({ applied: [], redo: [] });
  const [githubUrl, setGithubUrl] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [aiReviewBusy, setAiReviewBusy] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [editorDiagnostics, setEditorDiagnostics] = useState([]);
  const dirty = content !== savedContent;
  const hasCapability = useCallback((name) => runtime?.capabilities?.includes(name), [runtime?.capabilities]);

  const refreshWorkspaceIndex = useCallback(async (force = false) => {
    if (!runtime?.workspace || !hasCapability('workspace.index') || indexInFlightRef.current) return;
    indexInFlightRef.current = true;
    setIndexing(true);
    try {
      const output = await executeDesktopTool({ name: 'workspace.index', arguments: { force } });
      setIndexStatus(JSON.parse(output));
    } catch (indexError) {
      setError(indexError?.message || 'Could not index this workspace.');
    } finally {
      indexInFlightRef.current = false;
      setIndexing(false);
    }
  }, [hasCapability, runtime?.workspace]);

  const refreshApprovalStatus = useCallback(async () => {
    if (!hasCapability('approval.status')) return;
    try {
      const output = await executeDesktopTool({ name: 'approval.status', arguments: {} });
      setWorkspaceCommandsTrusted(Boolean(JSON.parse(output).workspaceCommandsTrusted));
    } catch {}
  }, [hasCapability]);

  const refreshReview = useCallback(async () => {
    if (!runtime?.workspace || !hasCapability('git.info')) return;
    setReviewLoading(true);
    setError('');
    try {
      const [infoOutput, diffOutput, journalOutput] = await Promise.all([
        executeDesktopTool({ name: 'git.info', arguments: {} }),
        executeDesktopTool({ name: 'git.diff', arguments: {} }),
        executeDesktopTool({ name: 'change.list', arguments: {} }),
      ]);
      setGitInfo(JSON.parse(infoOutput));
      setGitDiff(diffOutput === 'Command completed successfully.' ? '' : diffOutput);
      setChangeJournal(JSON.parse(journalOutput));
    } catch (reviewError) {
      setError(reviewError?.message || 'Could not review workspace changes.');
    } finally {
      setReviewLoading(false);
    }
  }, [hasCapability, runtime?.workspace]);

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
    const refreshPermissionStatus = () => getDesktopPermissionStatus().then((status) => {
      setPermissionStatus(status);
      const introSeen = localStorage.getItem('mira-system-access-intro-v1') === 'seen';
      if (status?.platform === 'darwin' && (status.updateRequired || !status.accessibility) && !introSeen) {
        setShowPermissions(true);
      }
    }).catch(() => setPermissionStatus(null));
    refreshPermissionStatus();
    window.addEventListener('focus', refreshPermissionStatus);
    return () => window.removeEventListener('focus', refreshPermissionStatus);
  }, [loadDirectory]);

  useEffect(() => {
    const unsubscribe = window.miraDesktop?.onTerminalOutput?.(({ requestId, chunk, reset, agent, done }) => {
      const activeManualRequest = requestId && requestId === terminalRequestRef.current;
      if (!activeManualRequest && !agent) return;
      if (requestId) setActiveTerminalRequestId(done ? '' : requestId);
      if (chunk) setTerminalOutput((current) => reset ? chunk : `${current}${chunk}`);
      const localUrl = extractTerminalLinks(chunk).map(normalizeLocalPreviewUrl).find(Boolean);
      if (localUrl) {
        setBrowserUrl(localUrl);
        setShowBrowser(true);
      }
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, []);

  useEffect(() => {
    const output = terminalOutputRef.current;
    if (!output) return undefined;
    const frame = requestAnimationFrame(() => {
      output.scrollTop = output.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [terminalHeight, terminalOutput]);

  useEffect(() => {
    if (!runtime?.workspace) return;
    refreshApprovalStatus();
    refreshWorkspaceIndex(false);
  }, [refreshApprovalStatus, refreshWorkspaceIndex, runtime?.workspace]);

  function closePermissions() {
    localStorage.setItem('mira-system-access-intro-v1', 'seen');
    setShowPermissions(false);
  }

  async function requestPermission(permission) {
    setPermissionBusy(permission);
    setPermissionError('');
    setPermissionMessage('');
    try {
      const next = await requestDesktopPermission(permission);
      setPermissionStatus(next);
      if (next?.settingsOpened) {
        setPermissionMessage('macOS System Settings opened. Enable MIRA, then return to the app.');
      }
    } catch (permissionError) {
      setPermissionError(permissionError?.message || 'Could not open system permissions.');
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
      setActivePreview(null);
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
    setEditorDiagnostics([]);
    try {
      const extension = entry.path.split('.').pop()?.toLowerCase();
      if (PREVIEW_EXTENSIONS.has(extension) && hasCapability('filesystem.preview')) {
        const output = await executeDesktopTool({ name: 'filesystem.preview', arguments: { path: entry.path } });
        setActiveFile(entry.path);
        setActivePreview(JSON.parse(output));
        setContent('');
        setSavedContent('');
        return;
      }
      const next = await executeDesktopTool({ name: 'filesystem.read', arguments: { path: entry.path } });
      setActiveFile(entry.path);
      setActivePreview(null);
      setContent(next);
      setSavedContent(next);
    } catch (openError) {
      setError(openError?.message || 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  async function saveFile() {
    if (!activeFile || activePreview || !dirty) return;
    setLoading(true);
    setError('');
    try {
      await executeDesktopTool({ name: 'filesystem.write', arguments: { path: activeFile, content } });
      setSavedContent(content);
      if (showReview) await refreshReview();
    } catch (saveError) {
      setError(saveError?.message || 'Could not save that file.');
    } finally {
      setLoading(false);
    }
  }

  async function runWorkspaceAction(name, argumentsValue = {}) {
    if (actionBusy) return;
    setActionBusy(name);
    setError('');
    try {
      const output = await executeDesktopTool({ name, arguments: argumentsValue });
      if (name === 'git.pull' || name === 'git.push' || name === 'git.commit') setTerminalOutput(output);
      if (name === 'change.undo' || name === 'change.redo') {
        await loadDirectory(directory);
        if (activeFile) {
          try {
            if (activePreview) {
              const nextPreview = await executeDesktopTool({ name: 'filesystem.preview', arguments: { path: activeFile } });
              setActivePreview(JSON.parse(nextPreview));
            } else {
              const nextContent = await executeDesktopTool({ name: 'filesystem.read', arguments: { path: activeFile } });
              setContent(nextContent);
              setSavedContent(nextContent);
            }
          } catch {
            setActiveFile('');
            setActivePreview(null);
            setContent('');
            setSavedContent('');
          }
        }
      }
      if (name === 'git.remote.set') setGithubUrl('');
      if (name === 'git.commit') setCommitMessage('');
      await refreshReview();
    } catch (actionError) {
      setError(actionError?.message || 'The workspace action failed.');
    } finally {
      setActionBusy('');
    }
  }

  async function openReview() {
    setShowReview(true);
    await refreshReview();
  }

  async function runCommand(event) {
    event?.preventDefault();
    if (!command.trim() || commandRunning) return;
    setCommandRunning(true);
    setError('');
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    terminalRequestRef.current = requestId;
    setActiveTerminalRequestId(requestId);
    commandHistoryRef.current = [...commandHistoryRef.current.filter((item) => item !== command.trim()), command.trim()].slice(-100);
    commandHistoryIndexRef.current = commandHistoryRef.current.length;
    setTerminalOutput(`$ ${command}\n`);
    try {
      const [executable, ...args] = parseCommandLine(command);
      const output = await executeDesktopTool({
        name: 'shell.run',
        arguments: { command: executable, args, cwd: directory || '.', requestId },
      });
      setTerminalOutput((current) => current.trim() === `$ ${command}` ? `$ ${command}\n${output}` : current);
      setCommand('');
    } catch (commandError) {
      setTerminalOutput(`$ ${command}\nError: ${commandError?.message || 'Command failed.'}`);
    } finally {
      terminalRequestRef.current = '';
      setActiveTerminalRequestId('');
      setCommandRunning(false);
    }
  }

  async function stopCommand() {
    if (!activeTerminalRequestId || !hasCapability('shell.cancel')) return;
    try {
      await executeDesktopTool({ name: 'shell.cancel', arguments: { requestId: activeTerminalRequestId } });
    } catch (stopError) {
      setError(stopError?.message || 'Could not stop the command.');
    }
  }

  function handleTerminalKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setTerminalOutput('');
      return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !commandHistoryRef.current.length) return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    commandHistoryIndexRef.current = Math.max(0, Math.min(commandHistoryRef.current.length, commandHistoryIndexRef.current + delta));
    setCommand(commandHistoryRef.current[commandHistoryIndexRef.current] || '');
  }

  function openLocalPreview(value) {
    const next = normalizeLocalPreviewUrl(value);
    if (!next) return;
    setBrowserUrl(next);
    setShowBrowser(true);
  }

  async function generateGitText(task) {
    if (aiReviewBusy || !gitDiff.trim()) return;
    setAiReviewBusy(task);
    setError('');
    try {
      const response = await fetch('/api/code-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, diff: gitDiff, status: gitInfo.status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.suggestion) throw new Error(payload.error || 'AI suggestion failed.');
      if (task === 'commit') setCommitMessage(String(payload.suggestion).split('\n')[0].slice(0, 200));
      else setReviewComment(String(payload.suggestion));
    } catch (assistError) {
      setError(assistError?.message || 'Could not generate the GitHub text.');
    } finally {
      setAiReviewBusy('');
    }
  }

  async function toggleWorkspaceCommandTrust() {
    if (!hasCapability('approval.set')) return;
    try {
      const output = await executeDesktopTool({
        name: 'approval.set',
        arguments: { workspaceCommandsTrusted: !workspaceCommandsTrusted },
      });
      setWorkspaceCommandsTrusted(Boolean(JSON.parse(output).workspaceCommandsTrusted));
    } catch (trustError) {
      setPermissionError(trustError?.message || 'Could not update command approval settings.');
    }
  }

  function startExplorerResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const onMove = (moveEvent) => {
      const next = Math.max(170, Math.min(460, startWidth + moveEvent.clientX - startX));
      setExplorerWidth(next);
      localStorage.setItem('mira_explorer_width', String(next));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startTerminalResize(event) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const onMove = (moveEvent) => {
      const next = Math.max(130, Math.min(620, startHeight + startY - moveEvent.clientY));
      setTerminalHeight(next);
      localStorage.setItem('mira_terminal_height', String(next));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function resizeExplorerWithKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(170, Math.min(460, explorerWidth + (event.key === 'ArrowRight' ? 16 : -16)));
    setExplorerWidth(next);
    localStorage.setItem('mira_explorer_width', String(next));
  }

  function resizeTerminalWithKeyboard(event) {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(130, Math.min(620, terminalHeight + (event.key === 'ArrowUp' ? 16 : -16)));
    setTerminalHeight(next);
    localStorage.setItem('mira_terminal_height', String(next));
  }

  return (
    <section className="desktop-workspace" aria-label="MIRA workspace IDE" style={style}>
      <header className="desktop-workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 size={16} />
          <strong className="truncate">{workspaceName}</strong>
          {activeFile && <span className="truncate text-[11px] opacity-60">/ {activeFile}{dirty ? ' •' : ''}</span>}
        </div>
        <div className="flex items-center gap-2">
          {hasCapability('git.info') && (
            <button type="button" onClick={openReview} className="desktop-ide-button" aria-label="Review changes and GitHub sync">
              <GitBranch size={13} /> Review
            </button>
          )}
          {hasCapability('workspace.index') && (
            <button type="button" onClick={() => refreshWorkspaceIndex(true)} disabled={indexing} className="desktop-ide-button" aria-label="Refresh local code index">
              <RefreshCw size={13} className={indexing ? 'animate-spin' : ''} /> {indexing ? 'Indexing' : indexStatus ? `${indexStatus.indexedFiles} indexed` : 'Index'}
            </button>
          )}
          <button type="button" onClick={() => setShowBrowser((current) => !current)} className="desktop-ide-button" aria-pressed={showBrowser} aria-label="Toggle localhost preview browser">
            <Globe2 size={13} /> Preview
          </button>
          <button type="button" onClick={() => setShowPermissions(true)} className="desktop-ide-button" aria-label="Configure system access">
            <ShieldCheck size={13} /> System access
          </button>
          <button type="button" onClick={chooseWorkspace} className="desktop-ide-button">{runtime?.workspace ? 'Switch folder' : 'Open folder'}</button>
        </div>
      </header>

      <div className="desktop-workspace-body">
        <aside className="desktop-explorer" aria-label="File explorer" style={{ width: explorerWidth }}>
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
        <div className="desktop-explorer-resizer" onMouseDown={startExplorerResize} onKeyDown={resizeExplorerWithKeyboard} role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize file explorer" />

        <div className="desktop-editor-column">
          <div className="desktop-editor-toolbar">
            <span>{showBrowser ? 'Local preview' : activePreview ? `${activePreview.kind} preview` : activeFile ? languageFor(activeFile) : 'Editor'}</span>
            {!showBrowser && activeFile && !activePreview && (
              <span className={`desktop-diagnostic-count ${editorDiagnostics.length ? 'has-errors' : ''}`}>
                {editorDiagnostics.length ? `${editorDiagnostics.length} syntax issue${editorDiagnostics.length === 1 ? '' : 's'}` : 'Syntax clean'}
              </span>
            )}
            <button type="button" onClick={saveFile} disabled={Boolean(activePreview) || !dirty || loading} className="desktop-ide-button" aria-label="Save current file"><Save size={13} /> Save</button>
          </div>
          {showBrowser ? (
            <WorkspaceBrowser initialUrl={browserUrl} onClose={() => setShowBrowser(false)} />
          ) : activePreview ? (
            <WorkspaceFilePreview file={activePreview} />
          ) : activeFile ? (
            <WorkspaceCodeEditor
              path={activeFile}
              value={content}
              onChange={setContent}
              onSave={saveFile}
              onDiagnostics={setEditorDiagnostics}
            />
          ) : (
            <div className="desktop-editor-empty"><Code2 size={28} /><p>Choose a file from Explorer to start editing.</p></div>
          )}

          <div className="desktop-terminal" style={{ height: terminalHeight }}>
            <div className="desktop-terminal-resizer" onMouseDown={startTerminalResize} onKeyDown={resizeTerminalWithKeyboard} role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Resize terminal" />
            <div className="desktop-pane-title">
              <span className="inline-flex items-center gap-2"><TerminalSquare size={14} />Terminal <em>{activeTerminalRequestId ? 'running' : 'ready'}</em></span>
              <span className="desktop-terminal-actions">
                <span>{directory || '.'}</span>
                {activeTerminalRequestId && <button type="button" onClick={stopCommand} aria-label="Stop running command"><Square size={12} /></button>}
                <button type="button" onClick={() => setTerminalOutput('')} aria-label="Clear terminal"><Trash2 size={12} /></button>
              </span>
            </div>
            <pre ref={terminalOutputRef} aria-live="polite"><TerminalOutput value={terminalOutput} onOpenLocal={openLocalPreview} /></pre>
            <form onSubmit={runCommand} className="desktop-terminal-input">
              <span>$</span>
              <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={handleTerminalKeyDown} placeholder="Run a command · ↑ history · Ctrl/⌘ L clear" disabled={!runtime?.workspace || commandRunning} aria-label="Terminal command" />
              <button type="submit" disabled={!command.trim() || commandRunning} aria-label="Run command"><Play size={13} /></button>
            </form>
          </div>
        </div>
      </div>
      {error && <div className="desktop-workspace-error" role="alert">{error}</div>}
      {showReview && (
        <div className="desktop-permission-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-review-title">
          <section className="desktop-review-dialog">
            <div className="desktop-permission-heading">
              <div>
                <span className="desktop-permission-eyebrow">Workspace history</span>
                <h2 id="desktop-review-title">Review changes & GitHub</h2>
              </div>
              <button type="button" onClick={() => setShowReview(false)} aria-label="Close change review"><X size={18} /></button>
            </div>

            <div className="desktop-review-actions">
              <button type="button" onClick={() => runWorkspaceAction('change.undo')} disabled={actionBusy || !changeJournal.applied.length} className="desktop-ide-button"><RotateCcw size={13} /> Undo</button>
              <button type="button" onClick={() => runWorkspaceAction('change.redo')} disabled={actionBusy || !changeJournal.redo.length} className="desktop-ide-button"><RotateCw size={13} /> Redo</button>
              <button type="button" onClick={refreshReview} disabled={reviewLoading} className="desktop-ide-button"><RefreshCw size={13} /> Refresh</button>
            </div>

            <section className="desktop-git-card">
              <div className="desktop-git-summary">
                <span><GitBranch size={14} /> {gitInfo.branch || 'No branch'}</span>
                <span><Github size={14} /> {gitInfo.remote || 'GitHub not connected'}</span>
              </div>
              {gitInfo.remote ? (
                <>
                  <form onSubmit={(event) => { event.preventDefault(); runWorkspaceAction('git.commit', { message: commitMessage }); }} className="desktop-github-connect">
                    <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={200} placeholder="Commit message" aria-label="Git commit message" />
                    <button type="button" onClick={() => generateGitText('commit')} disabled={aiReviewBusy || !gitDiff.trim()} className="desktop-ide-button"><Sparkles size={13} /> AI</button>
                    <button type="submit" disabled={actionBusy || !commitMessage.trim()} className="desktop-ide-button"><History size={13} /> Commit</button>
                  </form>
                  <div className="desktop-review-actions">
                    <button type="button" onClick={() => runWorkspaceAction('git.pull')} disabled={actionBusy} className="desktop-ide-button"><Download size={13} /> Pull</button>
                    <button type="button" onClick={() => runWorkspaceAction('git.push')} disabled={actionBusy} className="desktop-ide-button"><UploadCloud size={13} /> Push</button>
                  </div>
                </>
              ) : (
                <form onSubmit={(event) => { event.preventDefault(); runWorkspaceAction('git.remote.set', { url: githubUrl }); }} className="desktop-github-connect">
                  <input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" aria-label="GitHub repository URL" />
                  <button type="submit" disabled={actionBusy || !githubUrl.trim()} className="desktop-ide-button"><Github size={13} /> Connect</button>
                </form>
              )}
            </section>

            <div className="desktop-review-grid">
              <section>
                <h3><History size={13} /> MIRA changes</h3>
                {changeJournal.applied.length ? changeJournal.applied.slice().reverse().map((change) => <p key={change.id}>{change.path}</p>) : <p>No MIRA-applied changes this session.</p>}
              </section>
              <section>
                <h3>Git status</h3>
                <pre>{gitInfo.status || 'Working tree clean.'}</pre>
              </section>
            </div>
            <section className="desktop-diff-review">
              <h3>Uncommitted diff</h3>
              <pre>{gitDiff || 'No uncommitted diff.'}</pre>
            </section>
            <section className="desktop-github-comment">
              <div>
                <h3>GitHub review summary</h3>
                <div className="desktop-review-actions">
                  <button type="button" onClick={() => generateGitText('github-comment')} disabled={aiReviewBusy || !gitDiff.trim()} className="desktop-ide-button"><Sparkles size={13} /> {aiReviewBusy === 'github-comment' ? 'Writing…' : 'AI draft'}</button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(reviewComment)} disabled={!reviewComment} className="desktop-ide-button"><Copy size={13} /> Copy</button>
                </div>
              </div>
              <textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Draft a pull-request description or review comment from the current diff." aria-label="GitHub review summary" />
            </section>
          </section>
        </div>
      )}
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
            <p>MIRA requests each macOS permission explicitly. File and command access remains limited to the selected workspace; non-destructive commands can be trusted for the current workspace session.</p>
            {permissionStatus?.updateRequired && (
              <p className="desktop-permission-alert" role="alert">This installed MIRA desktop shell is outdated. Install the latest desktop build to enable native permission prompts.</p>
            )}
            <div className="desktop-permission-list">
              <article>
                <div><strong>Accessibility</strong><span>Allows approved desktop automation.</span></div>
                <button type="button" onClick={() => requestPermission('accessibility')} disabled={permissionStatus?.updateRequired || permissionBusy === 'accessibility' || permissionStatus?.accessibility === true} className="desktop-ide-button">
                  {permissionStatus?.updateRequired ? 'Update required' : permissionStatus?.accessibility === true ? 'Allowed' : permissionBusy === 'accessibility' ? 'Opening…' : 'Request access'}
                </button>
              </article>
              <article>
                <div><strong>Full Disk Access</strong><span>Lets selected workspaces include protected folders.</span></div>
                <button type="button" onClick={() => requestPermission('full-disk-access')} disabled={permissionStatus?.updateRequired || permissionBusy === 'full-disk-access'} className="desktop-ide-button">
                  {permissionStatus?.updateRequired ? 'Update required' : permissionBusy === 'full-disk-access' ? 'Opening…' : 'Open settings'}
                </button>
              </article>
              {hasCapability('approval.set') && (
                <article>
                  <div><strong>Workspace commands</strong><span>Skip repeated prompts for non-destructive commands until MIRA quits or you switch folders.</span></div>
                  <button type="button" onClick={toggleWorkspaceCommandTrust} className="desktop-ide-button">
                    {workspaceCommandsTrusted ? 'Revoke session trust' : 'Trust this session'}
                  </button>
                </article>
              )}
            </div>
            {permissionError && <p className="desktop-permission-alert" role="alert">{permissionError}</p>}
            {permissionMessage && <p className="desktop-permission-success" role="status">{permissionMessage}</p>}
            {permissionStatus && !permissionStatus.updateRequired && permissionStatus.platform !== 'darwin' && (
              <p className="desktop-permission-note">Your operating system does not require macOS Accessibility permission. Workspace selection and per-command approval remain active.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

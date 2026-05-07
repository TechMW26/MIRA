<<<<<<< Updated upstream
=======
<<<<<<< HEAD
import { useMemo, useState } from 'react';
import { Code2, Copy, Download, FileText, Send, Sparkles, X } from 'lucide-react';

function extractArtifacts(messages) {
  const artifacts = [];
  const blockPattern = /```(\w+)?\n([\s\S]*?)```/g;

  for (const message of messages || []) {
    if (message.role !== 'assistant' || !message.content) continue;
    let match;
    while ((match = blockPattern.exec(message.content))) {
      const language = match[1] || 'text';
      const content = match[2].trim();
      if (!content) continue;
      artifacts.push({
        id: `${message.id || artifacts.length}-${artifacts.length}`,
        title: `${language.toUpperCase()} artifact`,
        language,
        content,
      });
    }
  }

  return artifacts.reverse();
}

function downloadText(artifact) {
  const extension = artifact.language === 'javascript' ? 'js' : artifact.language === 'typescript' ? 'ts' : artifact.language || 'txt';
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mira-canvas.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CanvasPanel({ messages, onClose, onRequestCanvas }) {
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);
  const [selectedId, setSelectedId] = useState('');
  const [prompt, setPrompt] = useState('');
  const selected = artifacts.find((artifact) => artifact.id === selectedId) || artifacts[0] || null;

  function requestCanvas(event) {
    event?.preventDefault();
    const value = prompt.trim();
    if (!value) return;
    onRequestCanvas(value);
    setPrompt('');
  }

  async function copySelected() {
    if (!selected?.content) return;
    await navigator.clipboard?.writeText(selected.content);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <Code2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Canvas</span>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70" title="Close"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
      </div>

      <form onSubmit={requestCanvas} className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask MIRA to draft code, a chart, a mind map, or a document section..."
          rows={3}
          className="w-full text-xs px-3 py-2 rounded-xl outline-none resize-none"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <button
          type="submit"
          disabled={!prompt.trim()}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Sparkles size={12} /> Create on Canvas
        </button>
      </form>

      <div className="flex gap-1 p-2 flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
        {artifacts.length === 0 ? (
          <span className="text-[11px] px-2 py-1.5" style={{ color: 'var(--text-tertiary)' }}>No artifacts yet</span>
        ) : artifacts.map((artifact) => (
          <button
            key={artifact.id}
            onClick={() => setSelectedId(artifact.id)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0"
            style={{ background: selected?.id === artifact.id ? 'var(--accent)' : 'var(--hover-bg)', color: selected?.id === artifact.id ? '#fff' : 'var(--text-secondary)' }}
          >
            <FileText size={11} />{artifact.language}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!selected ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
            Generated code blocks and structured artifacts will appear here.
          </p>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--glass-bg)' }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{selected.title}</span>
              <button onClick={copySelected} className="p-1.5 rounded-lg hover:opacity-75" style={{ color: 'var(--text-tertiary)' }} title="Copy">
                <Copy size={12} />
              </button>
              <button onClick={() => downloadText(selected)} className="p-1.5 rounded-lg hover:opacity-75" style={{ color: 'var(--text-tertiary)' }} title="Download">
                <Download size={12} />
              </button>
            </div>
            <pre className="text-xs p-3 overflow-auto whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)', maxHeight: 'calc(100vh - 270px)' }}>{selected.content}</pre>
          </div>
        )}
      </div>

      {selected && (
        <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => onRequestCanvas(`Improve this ${selected.language} artifact:\n\n${selected.content}`)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium" style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Send size={12} /> Refine with MIRA
          </button>
        </div>
      )}
    </div>
  );
}
=======
>>>>>>> Stashed changes
import { useState, useRef } from 'react';
import { X, RefreshCw, Download, Code2, Eye, Copy, Check, Maximize2 } from 'lucide-react';

const RENDERABLE_TYPES = new Set(['html', 'svg', 'react']);

function normalizeLang(lang) {
  const l = (lang || '').toLowerCase().trim();
  if (l === 'html' || l === 'htm') return 'html';
  if (l === 'svg') return 'svg';
  if (l === 'jsx' || l === 'tsx' || l === 'react') return 'react';
  if (l === 'js' || l === 'javascript') return 'javascript';
  if (l === 'ts' || l === 'typescript') return 'typescript';
  if (l === 'css') return 'css';
  if (l === 'py' || l === 'python') return 'python';
  return l || 'text';
}

function extractArtifact(content) {
  if (!content) return null;

  // Full HTML document anywhere in content
  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(content)) {
    const m = content.match(/(<!DOCTYPE[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i);
    if (m) return { type: 'html', code: m[1] };
  }

  // Inline SVG (no fence)
  const inlineSvg = content.match(/<svg[\s\S]*?<\/svg>/i);

  // Any fenced code block: ```lang ... ```
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = fenceRegex.exec(content)) !== null) {
    const type = normalizeLang(match[1]);
    const code = (match[2] || '').replace(/\s+$/, '');
    if (code) blocks.push({ type, code });
  }

  if (blocks.length === 0) {
    if (inlineSvg) return { type: 'svg', code: inlineSvg[0] };
    return null;
  }

  // Prefer the last renderable block; otherwise the last code block.
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (RENDERABLE_TYPES.has(blocks[i].type)) return blocks[i];
  }
  return blocks[blocks.length - 1];
}

function buildPreviewHtml(artifact) {
  if (artifact.type === 'html') {
    if (artifact.code.includes('<!DOCTYPE') || artifact.code.includes('<html')) return artifact.code;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:16px;}</style></head><body>${artifact.code}</body></html>`;
  }
  if (artifact.type === 'svg') {
    return `<!DOCTYPE html><html><head><style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}</style></head><body>${artifact.code}</body></html>`;
  }
  // React — wrap in a simple runner
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><style>body{font-family:system-ui,sans-serif;margin:16px;}</style></head><body><div id="root"></div><script type="text/babel">${artifact.code}\nconst rootEl = document.getElementById('root');\nconst root = ReactDOM.createRoot(rootEl);\ntry { root.render(React.createElement(typeof App !== 'undefined' ? App : 'div', null, 'Component loaded')); } catch(e) { rootEl.innerHTML = '<pre style="color:red">'+e.message+'</pre>'; }</script></body></html>`;
}

export default function CanvasPanel({ messages, onClose }) {
  const [tab, setTab] = useState('preview'); // 'preview' | 'code'
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef(null);

  // Find latest artifact from messages (assistant first, then any role as fallback)
  const artifact = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && messages[i]?.content) {
        const a = extractArtifact(messages[i].content);
        if (a) return a;
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.content) {
        const a = extractArtifact(messages[i].content);
        if (a) return a;
      }
    }
    return null;
  })();

  const canPreview = artifact && RENDERABLE_TYPES.has(artifact.type);
  const previewHtml = canPreview ? buildPreviewHtml(artifact) : null;
  const effectiveTab = canPreview ? tab : 'code';

  function handleCopy() {
    if (artifact) {
      navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload() {
    if (!artifact) return;
    const ext = artifact.type === 'react' ? 'jsx' : artifact.type;
    const blob = new Blob([artifact.type === 'html' ? (previewHtml || artifact.code) : artifact.code], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mira-artifact.${ext}`;
    a.click();
  }

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-[300]' : 'h-full w-full'}`}
      style={fullscreen ? { background: 'var(--bg-primary)' } : undefined}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <Code2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
          Canvas {artifact ? `· ${artifact.type.toUpperCase()}` : ''}
        </span>
        <div className="flex items-center gap-1">
          {canPreview && (
            <button onClick={() => setTab(t => t === 'preview' ? 'code' : 'preview')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all hover:opacity-80"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>
              {tab === 'preview' ? <><Code2 size={10} /> Code</> : <><Eye size={10} /> Preview</>}
            </button>
          )}
          {artifact && <>
            <button onClick={handleCopy} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              {copied ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
            </button>
            <button onClick={handleDownload} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              <Download size={12} />
            </button>
            {canPreview && (
              <button onClick={() => setReloadKey(k => k + 1)}
                className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                <RefreshCw size={12} />
              </button>
            )}
          </>}
          <button onClick={() => setFullscreen(f => !f)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
            <Maximize2 size={12} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!artifact ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            <Code2 size={32} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No artifact yet</p>
            <p className="text-xs max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
              Ask MIRA to build something — "create an HTML page", "build a React component", "make an SVG logo"
            </p>
          </div>
        ) : effectiveTab === 'preview' ? (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={previewHtml || ''}
            className="w-full h-full border-0"
            title="Canvas Preview"
            sandbox="allow-scripts allow-forms allow-popups"
          />
        ) : (
          <pre className="p-4 text-xs overflow-auto h-full whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {artifact.code}
          </pre>
        )}
      </div>
    </div>
  );
}
<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes

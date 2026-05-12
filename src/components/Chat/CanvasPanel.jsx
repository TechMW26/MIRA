<<<<<<< HEAD
import { useMemo, useState } from 'react';

export default function CanvasPanel({ messages, onClose, onRequestCanvas }) {
  const [prompt, setPrompt] = useState('');

  const canRequest = useMemo(() => prompt.trim().length > 0, [prompt]);

  return (
    <div className="h-full flex flex-col bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div className="font-semibold text-sm">Canvas</div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded hover:bg-white/10"
          aria-label="Close Canvas Panel"
        >
          Close
        </button>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        <div className="text-xs text-white/70 mb-2">
          Describe what you want to generate. This will be sent to chat as a request.
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., Create a diagram of the MIRA architecture..."
          className="w-full min-h-32 resize-none p-2 text-sm rounded bg-black/20 border border-white/10 outline-none focus:border-white/25"
        />

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (!canRequest) return;
              onRequestCanvas?.(prompt.trim());
              setPrompt('');
              onClose?.();
            }}
            disabled={!canRequest}
            className="flex-1 text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            Request Canvas
          </button>
        </div>

        {Array.isArray(messages) && messages.length > 0 && (
          <div className="mt-4 text-[11px] text-white/50">
            Using {messages.length} message(s) for context.
          </div>
        )}
      </div>

      <div className="p-3 border-t border-white/10 text-[11px] text-white/50">
        Tip: keep prompts specific and actionable.
=======
import { useState, useRef } from 'react';
import { X, RefreshCw, Download, Code2, Eye, Copy, Check, Maximize2 } from 'lucide-react';

const RENDERABLE_TYPES = new Set(['html', 'svg', 'react']);

function normalizeLang(lang) {
  const value = (lang || '').toLowerCase().trim();
  if (value === 'html' || value === 'htm') return 'html';
  if (value === 'svg') return 'svg';
  if (value === 'jsx' || value === 'tsx' || value === 'react') return 'react';
  if (value === 'js' || value === 'javascript') return 'javascript';
  if (value === 'ts' || value === 'typescript') return 'typescript';
  if (value === 'css') return 'css';
  if (value === 'py' || value === 'python') return 'python';
  return value || 'text';
}

function extractArtifact(content) {
  if (!content) return null;

  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(content)) {
    const match = content.match(/(<!DOCTYPE[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i);
    if (match) return { type: 'html', code: match[1] };
  }

  const inlineSvg = content.match(/<svg[\s\S]*?<\/svg>/i);
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><style>body{font-family:system-ui,sans-serif;margin:16px;}</style></head><body><div id="root"></div><script type="text/babel">${artifact.code}\nconst rootEl = document.getElementById('root');\nconst root = ReactDOM.createRoot(rootEl);\ntry { root.render(React.createElement(typeof App !== 'undefined' ? App : 'div', null, 'Component loaded')); } catch(e) { rootEl.innerHTML = '<pre style="color:red">'+e.message+'</pre>'; }</script></body></html>`;
}

export default function CanvasPanel({ messages, onClose }) {
  const [tab, setTab] = useState('preview');
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef(null);

  const artifact = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && messages[i]?.content) {
        const candidate = extractArtifact(messages[i].content);
        if (candidate) return candidate;
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.content) {
        const candidate = extractArtifact(messages[i].content);
        if (candidate) return candidate;
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
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `mira-artifact.${ext}`;
    anchor.click();
  }

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-[300]' : 'h-full w-full'}`}
      style={fullscreen ? { background: 'var(--bg-primary)' } : undefined}>
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <Code2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
          Canvas {artifact ? `· ${artifact.type.toUpperCase()}` : ''}
        </span>
        <div className="flex items-center gap-1">
          {canPreview && (
            <button onClick={() => setTab(current => current === 'preview' ? 'code' : 'preview')}
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
              <button onClick={() => setReloadKey(key => key + 1)}
                className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                <RefreshCw size={12} />
              </button>
            )}
          </>}
          <button onClick={() => setFullscreen(value => !value)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
            <Maximize2 size={12} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!artifact ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            <Code2 size={32} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No artifact yet</p>
            <p className="text-xs max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
              Ask MIRA to build something like an HTML page, a React component, or an SVG logo.
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
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
      </div>
    </div>
  );
}

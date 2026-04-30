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

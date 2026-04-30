import { useState, useRef, useEffect } from 'react';
import { X, RefreshCw, Download, Code2, Eye, Copy, Check, Maximize2 } from 'lucide-react';

function extractArtifact(content) {
  // Extract HTML artifact
  const htmlMatch = content.match(/```html\n([\s\S]*?)```/i);
  if (htmlMatch) return { type: 'html', code: htmlMatch[1] };

  // Extract React/JSX
  const reactMatch = content.match(/```(?:jsx?|tsx?)\n([\s\S]*?)```/i);
  if (reactMatch) return { type: 'react', code: reactMatch[1] };

  // Extract SVG
  const svgMatch = content.match(/```svg\n([\s\S]*?)```/i) || content.match(/(<svg[\s\S]*?<\/svg>)/i);
  if (svgMatch) return { type: 'svg', code: svgMatch[1] };

  // Full HTML document
  if (content.includes('<!DOCTYPE html') || content.includes('<html')) {
    return { type: 'html', code: content };
  }

  return null;
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
  const iframeRef = useRef(null);

  // Find latest artifact from messages
  const artifact = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content) {
        const a = extractArtifact(messages[i].content);
        if (a) return a;
      }
    }
    return null;
  })();

  const previewHtml = artifact ? buildPreviewHtml(artifact) : null;

  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      doc.open();
      doc.write(previewHtml);
      doc.close();
    }
  }, [previewHtml]);

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
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-[300]' : 'h-full'}`}
      style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)', width: fullscreen ? '100%' : undefined }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <Code2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
          Canvas {artifact ? `· ${artifact.type.toUpperCase()}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setTab(t => t === 'preview' ? 'code' : 'preview')}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all hover:opacity-80"
            style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>
            {tab === 'preview' ? <><Code2 size={10} /> Code</> : <><Eye size={10} /> Preview</>}
          </button>
          {artifact && <>
            <button onClick={handleCopy} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              {copied ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
            </button>
            <button onClick={handleDownload} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              <Download size={12} />
            </button>
            <button onClick={() => { if (iframeRef.current && previewHtml) { const d = iframeRef.current.contentDocument; d.open(); d.write(previewHtml); d.close(); } }}
              className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              <RefreshCw size={12} />
            </button>
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
        ) : tab === 'preview' ? (
          <iframe ref={iframeRef} className="w-full h-full border-0" title="Canvas Preview" sandbox="allow-scripts" />
        ) : (
          <pre className="p-4 text-xs overflow-auto h-full" style={{ color: 'var(--text-primary)', background: 'var(--bg-primary)', fontFamily: 'monospace' }}>
            {artifact.code}
          </pre>
        )}
      </div>
    </div>
  );
}

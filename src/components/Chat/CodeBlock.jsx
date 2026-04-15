import { useState, useRef, useCallback } from 'react';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

export default function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const codeRef = useRef(null);

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.textContent || children;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="my-3 rounded-xl overflow-hidden glass" style={{ border: '1px solid var(--border)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 text-xs"
        style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          <span className="ml-2 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
            {language || 'code'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg transition-all hover:scale-110"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg transition-all hover:scale-110"
            style={{ color: copied ? '#10b981' : 'var(--text-tertiary)' }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Code */}
      {!collapsed && (
        <div className="overflow-x-auto">
          <pre className="p-4 text-sm leading-relaxed m-0" style={{ background: 'transparent' }}>
            <code ref={codeRef} className={`language-${language || ''}`} style={{ color: 'var(--text-primary)' }}>
              {children}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}

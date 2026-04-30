import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X, ArrowLeft, ArrowRight, RotateCw, Globe, Sparkles,
  ExternalLink, Loader, Search, Plus, BookOpen,
  MessageSquareText, Copy, FileText,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function normalizeUrl(input) {
  const s = input.trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.includes('.') && !s.includes(' ')) return 'https://' + s;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

const QUICK_LINKS = [
  { label: 'Google', url: 'https://www.google.com/search?q=', icon: '🔍' },
  { label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '📖' },
  { label: 'GitHub', url: 'https://github.com', icon: '💻' },
  { label: 'Stack Overflow', url: 'https://stackoverflow.com', icon: '🧩' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com', icon: '📰' },
  { label: 'arXiv', url: 'https://arxiv.org', icon: '🔬' },
  { label: 'Reddit', url: 'https://www.reddit.com', icon: '💬' },
  { label: 'MDN', url: 'https://developer.mozilla.org', icon: '📚' },
];

let tabId = 1;
const mkTab = () => ({ id: tabId++, url: '', title: 'New Tab', page: null, loading: false, error: '', history: [], histIdx: -1 });

export default function BrowserPanel({ onSendToChat, onClose }) {
  const [tabs, setTabs] = useState([mkTab()]);
  const [activeTab, setActiveTab] = useState(0);
  const [inputUrl, setInputUrl] = useState('');
  const [selection, setSelection] = useState('');
  const [selPos, setSelPos] = useState(null);
  const [viewMode, setViewMode] = useState('reader'); // 'reader' | 'html'
  const contentRef = useRef(null);

  const tab = tabs[activeTab] || tabs[0];

  useEffect(() => { setInputUrl(tab?.url || ''); }, [activeTab, tab?.url]);

  // Text selection
  useEffect(() => {
    const handler = (e) => {
      if (!contentRef.current?.contains(e.target)) { setSelection(''); setSelPos(null); return; }
      setTimeout(() => {
        const sel = window.getSelection()?.toString().trim();
        if (sel?.length > 5) { setSelection(sel); setSelPos({ x: e.clientX, y: e.clientY }); }
        else { setSelection(''); setSelPos(null); }
      }, 10);
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, []);

  function updateTab(idx, updates) {
    setTabs(prev => prev.map((t, i) => i === idx ? { ...t, ...updates } : t));
  }

  const fetchPage = useCallback(async (rawUrl, tabIdx = activeTab, addHist = true) => {
    const target = normalizeUrl(rawUrl);
    if (!target) return;
    updateTab(tabIdx, { url: target, loading: true, error: '', page: null });
    setInputUrl(target);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTabs(prev => prev.map((t, i) => {
        if (i !== tabIdx) return t;
        const hist = addHist ? [...t.history.slice(0, t.histIdx + 1), data.url] : t.history;
        return { ...t, url: data.url, title: data.title || data.url, page: data, loading: false, error: '', history: hist, histIdx: addHist ? hist.length - 1 : t.histIdx };
      }));
      setInputUrl(data.url);
    } catch (e) {
      updateTab(tabIdx, { loading: false, error: e.message });
    }
  }, [activeTab]);

  const goBack = () => { if (tab.histIdx <= 0) return; updateTab(activeTab, { histIdx: tab.histIdx - 1 }); fetchPage(tab.history[tab.histIdx - 1], activeTab, false); };
  const goForward = () => { if (tab.histIdx >= tab.history.length - 1) return; updateTab(activeTab, { histIdx: tab.histIdx + 1 }); fetchPage(tab.history[tab.histIdx + 1], activeTab, false); };

  function handleContentClick(e) {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
    e.preventDefault();
    try {
      const abs = href.startsWith('http') ? href : new URL(href, tab.page?.url || '').href;
      fetchPage(abs);
    } catch {}
  }

  function addTab(url = '') {
    const t = mkTab();
    setTabs(prev => [...prev, t]);
    const newIdx = tabs.length;
    setActiveTab(newIdx);
    if (url) setTimeout(() => fetchPage(url, newIdx), 0);
  }

  function closeTab(idx, e) {
    e.stopPropagation();
    if (tabs.length === 1) { onClose(); return; }
    setTabs(prev => prev.filter((_, i) => i !== idx));
    setActiveTab(prev => Math.min(prev, tabs.length - 2));
  }

  function sendSelection() {
    onSendToChat(`From "${tab.page?.title || tab.url}":\n\n"${selection}"\n\nExplain or analyze this.`);
    setSelection(''); setSelPos(null); window.getSelection()?.removeAllRanges();
  }

  const mdComponents = {
    a: ({ href, children }) => (
      <a href={href} onClick={(e) => { e.preventDefault(); if (href) fetchPage(href); }}
        style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>
        {children}
      </a>
    ),
    img: ({ src, alt }) => src ? <img src={src} alt={alt || ''} style={{ maxWidth: '100%', borderRadius: 6, margin: '6px 0' }} /> : null,
    code: ({ inline, children }) => inline
      ? <code style={{ background: 'var(--hover-bg)', padding: '1px 5px', borderRadius: 4, fontSize: '0.85em', color: 'var(--accent)' }}>{children}</code>
      : <pre style={{ background: 'var(--hover-bg)', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: '0.85em', border: '1px solid var(--border)' }}><code>{children}</code></pre>,
    table: ({ children }) => <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>{children}</table></div>,
    th: ({ children }) => <th style={{ padding: '7px 10px', border: '1px solid var(--border)', background: 'var(--hover-bg)', fontWeight: 600, textAlign: 'left' }}>{children}</th>,
    td: ({ children }) => <td style={{ padding: '7px 10px', border: '1px solid var(--border)' }}>{children}</td>,
    blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 12, margin: '8px 0', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{children}</blockquote>,
  };

  return (
    <div className="flex h-full w-full">
      <div className="flex flex-col flex-1 min-w-0 h-full">

        {/* Tabs */}
        <div className="flex items-center overflow-x-auto flex-shrink-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', minHeight: 34 }}>
          {tabs.map((t, i) => (
            <div key={t.id} onClick={() => setActiveTab(i)} className="flex items-center gap-1.5 px-2.5 py-1 cursor-pointer flex-shrink-0 max-w-[150px] select-none"
              style={{ borderRight: '1px solid var(--border)', background: i === activeTab ? 'var(--bg-primary)' : 'transparent', borderBottom: i === activeTab ? '2px solid var(--accent)' : '2px solid transparent' }}>
              {t.loading
                ? <Loader size={10} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
                : t.page?.favicon
                  ? <img src={t.page.favicon} className="w-3 h-3 flex-shrink-0 rounded-sm" onError={e => e.target.style.display = 'none'} alt="" />
                  : <Globe size={10} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              }
              <span className="text-[11px] truncate" style={{ color: i === activeTab ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{t.title || 'New Tab'}</span>
              <button onClick={(e) => closeTab(i, e)} className="p-0.5 rounded hover:opacity-70 flex-shrink-0"><X size={9} style={{ color: 'var(--text-tertiary)' }} /></button>
            </div>
          ))}
          <button onClick={() => addTab()} className="p-1.5 hover:opacity-70 flex-shrink-0"><Plus size={12} style={{ color: 'var(--text-tertiary)' }} /></button>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 hover:opacity-70 flex-shrink-0"><X size={12} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>

        {/* Nav bar */}
        <div className="flex items-center gap-1 px-2 py-1.5 flex-shrink-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={goBack} disabled={tab.histIdx <= 0} className="p-1.5 rounded disabled:opacity-30 hover:opacity-70"><ArrowLeft size={12} style={{ color: 'var(--text-secondary)' }} /></button>
          <button onClick={goForward} disabled={tab.histIdx >= tab.history.length - 1} className="p-1.5 rounded disabled:opacity-30 hover:opacity-70"><ArrowRight size={12} style={{ color: 'var(--text-secondary)' }} /></button>
          <button onClick={() => tab.url && fetchPage(tab.url)} disabled={tab.loading} className="p-1.5 rounded disabled:opacity-30 hover:opacity-70">
            <RotateCw size={12} className={tab.loading ? 'animate-spin' : ''} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg mx-1" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
            {tab.loading ? <Loader size={10} className="animate-spin" style={{ color: 'var(--accent)' }} /> : <Search size={10} style={{ color: 'var(--text-tertiary)' }} />}
            <input value={inputUrl} onChange={e => setInputUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchPage(inputUrl)} onFocus={e => e.target.select()}
              className="flex-1 text-xs bg-transparent outline-none" style={{ color: 'var(--text-primary)' }}
              placeholder="Search or enter URL..." spellCheck={false} />
          </div>

          {tab.page && (
            <button onClick={() => setViewMode(v => v === 'reader' ? 'html' : 'reader')}
              className="p-1.5 rounded hover:opacity-70" title={viewMode === 'reader' ? 'Switch to HTML view' : 'Switch to Reader view'}
              style={{ color: viewMode === 'reader' ? 'var(--accent)' : 'var(--text-tertiary)' }}>
              <FileText size={12} />
            </button>
          )}
          <button onClick={() => tab.page && window.open(tab.page.url, '_blank')} disabled={!tab.page} className="p-1.5 rounded disabled:opacity-30 hover:opacity-70">
            <ExternalLink size={12} style={{ color: 'var(--text-tertiary)' }} />
          </button>
        </div>

        {/* MIRA action bar */}
        {tab.page && (
          <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" style={{ background: 'var(--accent-glow)', borderBottom: '1px solid var(--border)' }}>
            <Sparkles size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{tab.page.title}</span>
            <button onClick={() => onSendToChat(`Summarize this page:\n\nTitle: ${tab.page.title}\nURL: ${tab.page.url}\n\n${tab.page.content}`)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium hover:opacity-90 flex-shrink-0"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              <BookOpen size={10} /> Summarize
            </button>
            <button onClick={() => onSendToChat(`I'm reading: ${tab.page.url}\n\nTitle: ${tab.page.title}\n\nWhat would you like to know about this page?`)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium hover:opacity-90 flex-shrink-0"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
              <MessageSquareText size={10} /> Ask
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto" ref={contentRef}>

          {tab.loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
              <p className="text-[10px] max-w-xs text-center truncate px-4" style={{ color: 'var(--text-tertiary)' }}>{inputUrl}</p>
            </div>
          )}

          {!tab.loading && tab.error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <X size={20} style={{ color: '#ef4444' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Could not load page</p>
              <p className="text-xs max-w-xs" style={{ color: 'var(--text-tertiary)' }}>{tab.error}</p>
              <div className="flex gap-2 mt-1">
                <button onClick={() => window.open(inputUrl, '_blank')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
                  <ExternalLink size={12} /> Open in Browser
                </button>
                <button onClick={() => onSendToChat(`Tell me about: ${inputUrl}`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                  <Sparkles size={12} /> Ask MIRA
                </button>
              </div>
            </div>
          )}

          {!tab.loading && !tab.error && !tab.page && (
            <div className="p-4">
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>New Tab</p>
              <p className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)' }}>Enter a URL or search above</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_LINKS.map(({ label, url, icon }) => (
                  <button key={label} onClick={() => fetchPage(url)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-all hover:opacity-80 active:scale-95"
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    <span className="text-base leading-none">{icon}</span>{label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reader view — clean markdown */}
          {!tab.loading && !tab.error && tab.page && viewMode === 'reader' && (
            <div className="p-4" style={{ color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7 }}>
              <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{tab.page.title}</h1>
              <a href={tab.page.url} onClick={e => { e.preventDefault(); fetchPage(tab.page.url); }}
                className="text-[11px] mb-4 block truncate" style={{ color: 'var(--accent)' }}>{tab.page.url}</a>
              {tab.page.description && <p className="text-xs mb-4 italic" style={{ color: 'var(--text-tertiary)' }}>{tab.page.description}</p>}
              <hr style={{ borderColor: 'var(--border)', marginBottom: 16 }} />
              {tab.page.isMarkdown && tab.page.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {tab.page.content}
                </ReactMarkdown>
              ) : (
                <div className="browser-content" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: tab.page.html || '' }} />
              )}
            </div>
          )}

          {/* HTML view */}
          {!tab.loading && !tab.error && tab.page && viewMode === 'html' && (
            <div className="browser-content" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: tab.page.html || '<p style="padding:16px;color:var(--text-tertiary)">No HTML available</p>' }} />
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-2 px-3 py-1 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tab.loading ? '#f59e0b' : tab.page ? '#10b981' : tab.error ? '#ef4444' : 'var(--text-tertiary)' }} />
          <span className="text-[10px] truncate flex-1" style={{ color: 'var(--text-tertiary)' }}>
            {tab.loading ? 'Loading...' : tab.page ? tab.page.url : tab.error ? 'Error' : 'Ready'}
          </span>
          {tab.page?.isMarkdown && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>Reader Mode</span>}
        </div>

        {/* Selection popup */}
        {selection && selPos && (
          <div className="fixed z-[200] flex items-center gap-1 px-2 py-1.5 rounded-xl animate-fade-in"
            style={{ left: Math.min(selPos.x, window.innerWidth - 180), top: selPos.y - 50, background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
            <button onClick={sendSelection} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium hover:opacity-80" style={{ background: 'var(--accent)', color: '#fff' }}>
              <Sparkles size={10} /> Ask MIRA
            </button>
            <button onClick={() => { navigator.clipboard.writeText(selection); setSelection(''); setSelPos(null); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] hover:opacity-80" style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)' }}>
              <Copy size={10} /> Copy
            </button>
            <button onClick={() => { setSelection(''); setSelPos(null); }} className="p-1 rounded hover:opacity-70"><X size={10} style={{ color: 'var(--text-tertiary)' }} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

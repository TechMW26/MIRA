import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Copy, Check, Volume2, VolumeX, User, FileText, FileCode, File, X, ExternalLink, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import MindMap from './MindMap';
import Chart from './Chart';
import ParticleText from './ParticleText';
import { exportDocument } from '../../utils/documentExport';

const IMAGE_GEN_PATTERN = /\[IMAGE_GEN:\s*([\s\S]*?)\]/i;

function extractImagePrompt(content = '') {
  const match = String(content).match(IMAGE_GEN_PATTERN);
  return match?.[1]?.trim() || '';
}

function buildGeneratedImageUrl(prompt) {
  const params = new URLSearchParams({
    width: '1024',
    height: '1024',
    nologo: 'true',
    enhance: 'true',
    model: 'flux',
    seed: String(Math.abs(hashString(prompt)) % 1000000),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

function hashString(value = '') {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function nodeToText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (node?.props?.children) return nodeToText(node.props.children);
  return '';
}

function normalizeExportFormat(value = '') {
  const lower = String(value).toLowerCase();
  if (/\bpdf\b/.test(lower)) return 'pdf';
  if (/\b(docx|word document|word file)\b/.test(lower)) return 'docx';
  if (/\b(pptx|powerpoint|presentation|slides?)\b/.test(lower)) return 'pptx';
  return '';
}

function getSuggestedExportFormat(message) {
  const explicit = normalizeExportFormat(message?.exportFormat || message?.documentFormat || '');
  if (explicit) return explicit;

  const content = String(message?.content || '');
  const hasExportCue = /\[(?:download button|page\s+\d+)\]|\b(download|export|save)\b/i.test(content);
  if (!hasExportCue) return '';
  return normalizeExportFormat(content);
}

function isFakeDownloadHref(href = '') {
  const value = String(href || '').trim().toLowerCase();
  return !value || value === '#' || value === 'about:blank' || value.startsWith('javascript:');
}

function getDownloadLinkFormat(children, href) {
  const combined = `${nodeToText(children)} ${href || ''}`;
  if (!/\b(download|export|save)\b/i.test(combined)) return '';
  return normalizeExportFormat(combined);
}

function cleanExportContent(content = '') {
  return String(content)
    .replace(/^\s*\[Download Button\]\s*$/gim, '')
    .replace(/^\s*\[Note:[\s\S]*?download[\s\S]*?\]\s*$/gim, '')
    .replace(/\[Download[^\]]*(?:PDF|DOCX|PPTX|Word|PowerPoint|Presentation|Slides)[^\]]*\]\([^)]*\)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatLabel(format) {
  if (format === 'docx') return 'DOCX';
  if (format === 'pptx') return 'PPTX';
  return 'PDF';
}

function getFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','py','java','c','cpp','html','css'].includes(ext)) return FileCode;
  if (['txt','md','csv','log','json','xml','yaml','yml'].includes(ext)) return FileText;
  return File;
}

function AttachmentPreview({ attachment }) {
  const [expanded, setExpanded] = useState(false);

  if (attachment.isImage && attachment.base64) {
    return (
      <div className="mt-2">
        <img
          src={attachment.base64}
          alt={attachment.name}
          className="rounded-xl max-w-full max-h-64 object-contain cursor-pointer transition-all hover:opacity-90"
          onClick={() => setExpanded(true)}
        />
        {expanded && (
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-fade-in"
            style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(8px)' }}
            onClick={() => setExpanded(false)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh]">
              <img src={attachment.base64} alt={attachment.name} className="rounded-2xl max-w-full max-h-[85vh] object-contain" />
              <button
                onClick={() => setExpanded(false)}
                className="absolute -top-3 -right-3 p-2 rounded-full glass"
                style={{ color: 'var(--text-primary)' }}
              >
                <X size={16} />
              </button>
              <p className="text-center text-xs mt-2 opacity-70" style={{ color: '#fff' }}>{attachment.name}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Document / non-image file
  const Icon = getFileIcon(attachment.name);
  const isParsed = Boolean(attachment.parsedText || attachment.parsed);
  const parseFailed = Boolean(attachment.parseError || (!isParsed && attachment.parsedText === ''));
  return (
    <div
      className="mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-xl glass-subtle cursor-pointer transition-all hover:opacity-80"
      onClick={() => {
        if (attachment.base64) {
          const a = document.createElement('a');
          a.href = attachment.base64;
          a.download = attachment.name;
          a.click();
        }
      }}
    >
      <Icon size={16} style={{ color: 'var(--accent)' }} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium truncate block" style={{ color: 'var(--text-primary)' }}>{attachment.name}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{attachment.type}</span>
      </div>
      {isParsed && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>parsed</span>
      )}
      {parseFailed && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>unread</span>
      )}
      <ExternalLink size={12} style={{ color: 'var(--text-tertiary)' }} />
    </div>
  );
}

function ThinkingSection({ content, isActive }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);
  const [lines, setLines] = useState([]);

  // Split streaming thinking content into lines that appear one by one
  useEffect(() => {
    if (!content) return;
    // Split on sentences / line breaks for a cascading effect
    const raw = content.replace(/\n{2,}/g, '\n').split(/(?<=[.!?])\s+|\n/);
    setLines(raw.filter(Boolean));
  }, [content]);

  useEffect(() => {
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, isActive]);

  if (!content) return null;

  if (isActive) {
    return (
      <div className="thinking-section mb-4">
        <div className="thinking-header">
          <span className="thinking-sparkle">✦</span>
          <span className="thinking-label">Thinking</span>
          <div className="thinking-pulse-bar">
            <div className="thinking-pulse-bar-inner" />
          </div>
        </div>
        <div ref={scrollRef} className="thinking-scroll">
          <div className="thinking-lines">
            {lines.map((line, i) => (
              <div
                key={i}
                className="thinking-line"
                style={{ animationDelay: `${Math.min(i * 0.05, 2)}s` }}
              >
                <span className="thinking-line-marker">›</span>
                <span className="thinking-line-text">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs py-1.5 px-2.5 rounded-lg transition-all hover:opacity-80"
        style={{ color: 'var(--text-tertiary)', background: 'var(--hover-bg)' }}
      >
        <span className="thinking-sparkle-static">✦</span>
        <span>Thought process</span>
        <span className={`transition-transform duration-200 text-[10px] ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {expanded && (
        <div
          className="thinking-expanded mt-2 px-3 py-2 rounded-xl text-xs leading-relaxed max-h-60 overflow-y-auto"
          style={{ color: 'var(--text-tertiary)', background: 'var(--glass-bg)', fontStyle: 'italic' }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

function ThinkingPlaceholder() {
  return (
    <ParticleText text="MIRA is forming the first words..." active placeholder />
  );
}

function GeneratedImageCard({ prompt }) {
  const imageUrl = useMemo(() => buildGeneratedImageUrl(prompt), [prompt]);
  return (
    <div className="generated-image-card">
      <div className="generated-image-frame">
        <img src={imageUrl} alt={prompt} loading="lazy" />
      </div>
      <div className="generated-image-meta">
        <span className="generated-image-label">Generated image</span>
        <p>{prompt}</p>
        <a href={imageUrl} target="_blank" rel="noopener noreferrer">Open full image</a>
      </div>
    </div>
  );
}

function DocumentDownloadAction({ format, exporting, exportError, onExport }) {
  if (!format) return null;
  const label = formatLabel(format);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={() => onExport(format)}
        disabled={exporting}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
        style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
      >
        <Download size={14} />
        {exporting ? `Preparing ${label}...` : `Download ${label}`}
      </button>
      <span className="text-[11px]" style={{ color: exportError ? '#ef4444' : 'var(--text-tertiary)' }}>
        {exportError || 'Ready as a real file export.'}
      </span>
    </div>
  );
}

function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const imagePrompt = !isUser ? extractImagePrompt(message.content) : '';
  const suggestedExportFormat = !isUser && !message.isStreaming && !imagePrompt
    ? getSuggestedExportFormat(message)
    : '';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const handleSpeak = useCallback(() => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const cleaned = message.content
      .replace(/```[\s\S]*?```/g, 'code block')
      .replace(/[#*`_~>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.rate = 1;
    utter.pitch = 1;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  }, [message.content, speaking]);

  const handleExport = useCallback(async (format) => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const filename = `mira-response-${Date.now()}.${format}`;
      await exportDocument(cleanExportContent(message.content), format, filename);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [message.content]);

  const markdownComponents = useMemo(() => ({
    img({ src, alt }) {
      const s = typeof src === 'string' ? src.trim() : '';

      // If markdown produces an empty url, don't render an <img> with empty src.
      if (!s) return null;

      // Sometimes we may receive raw base64 without data: prefix.
      const finalSrc = s.startsWith('data:')
        ? s
        : `data:image/png;base64,${s}`;

      // Guard: only allow image data urls
      if (!finalSrc.startsWith('data:image/')) return null;

      return (
        <img
          src={finalSrc}
          alt={alt || 'Generated Image'}
          className="rounded-xl my-3 max-w-full shadow-lg"
          style={{ maxHeight: '512px', objectFit: 'contain' }}
          loading="lazy"
          onError={(e) => {
            // Hide broken image and show message
            e.currentTarget.style.display = 'none';
            const msg = document.createElement('div');
            msg.className = 'text-sm py-3 px-4 rounded-xl my-2';
            msg.style.cssText = 'background: var(--glass-bg); color: var(--text-tertiary);';
            msg.textContent = 'Image failed to load — check the generated data URL.';
            e.currentTarget.parentNode.insertBefore(msg, e.currentTarget.nextSibling);
          }}
        />
      );
    },
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match?.[1];
      const raw = String(children).replace(/\n$/, '');
      if (!inline && lang === 'mindmap') return <MindMap content={raw} />;
      if (!inline && lang === 'chart') return <Chart content={raw} />;
      if (!inline && lang) return <CodeBlock language={lang}>{raw}</CodeBlock>;
      return (
        <code
          className="px-1.5 py-0.5 rounded-md text-sm font-mono"
          style={{ background: 'var(--glass-bg)', color: 'var(--accent)' }}
          {...props}
        >
          {children}
        </code>
      );
    },
    a({ href, children }) {
      const label = nodeToText(children);
      const linkFormat = getDownloadLinkFormat(children, href) || (/\b(download|export|save)\b/i.test(label) ? suggestedExportFormat : '');
      if (linkFormat && isFakeDownloadHref(href)) {
        return (
          <button
            type="button"
            onClick={() => handleExport(linkFormat)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all hover:opacity-90"
            style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
          >
            <Download size={13} />
            {label || `Download ${formatLabel(linkFormat)}`}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-violet-400/50 underline-offset-2 transition-colors" style={{ color: 'var(--accent)' }}>
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-3 rounded-xl" style={{ border: '1px solid var(--border)' }}>
          <table className="min-w-full text-sm">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return <th className="px-4 py-2.5 text-left font-semibold text-sm" style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}>{children}</th>;
    },
    td({ children }) {
      return <td className="px-4 py-2.5 text-sm" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{children}</td>;
    },
  }), [handleExport, suggestedExportFormat]);

  return (
    <div className={`group flex gap-3 px-4 lg:px-0 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <img src="/mira-logo.png" alt="MIRA" className="w-8 h-8 rounded-xl object-cover" />
        </div>
      )}

      {/* Message body */}
      <div className={`max-w-[85%] lg:max-w-[75%] ${isUser ? '' : 'flex-1 min-w-0'}`}>
        <div
          className={`rounded-2xl px-4 py-3 transition-all ${
            isUser
              ? ''
              : 'glass-subtle'
          }`}
          style={isUser ? { background: 'var(--user-bubble-bg)', color: 'var(--user-bubble-text)' } : { color: 'var(--text-primary)' }}
        >
          {message.image && message.image.length > 0 && (
            <img src={message.image} alt="Generated" className="rounded-xl mb-3 max-w-full shadow-lg" />
          )}

          {/* Animated image generation placeholder — moving gradient blobs */}
          {message.type === 'image_loading' && (
            <div className="w-64 h-64 rounded-xl overflow-hidden relative" style={{ background: '#0a0a12' }}>
              <div className="absolute w-40 h-40 rounded-full blur-2xl animate-[blobMove1_2s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(139,92,246,0.6)', top: '-10%', left: '-10%' }} />
              <div className="absolute w-36 h-36 rounded-full blur-2xl animate-[blobMove2_2.4s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(236,72,153,0.5)', bottom: '-10%', right: '-10%' }} />
              <div className="absolute w-32 h-32 rounded-full blur-3xl animate-[blobMove3_1.8s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(59,130,246,0.5)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
              <div className="absolute w-28 h-28 rounded-full blur-2xl animate-[blobMove4_2.2s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(168,85,247,0.4)', top: '20%', right: '10%' }} />
              <div className="absolute w-24 h-24 rounded-full blur-xl animate-[blobMove5_1.6s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(244,114,182,0.5)', bottom: '15%', left: '15%' }} />
            </div>
          )}

          {message.type !== 'image_loading' && isUser ? (
            <>
              {message.content && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              )}
              {message.attachments && message.attachments.length > 0 && (
                <div className="space-y-1">
                  {message.attachments.map((att, idx) => (
                    <AttachmentPreview key={idx} attachment={att} />
                  ))}
                </div>
              )}
            </>
          ) : message.type !== 'image_loading' && !isUser ? (
            <div className="prose prose-sm max-w-none prose-headings:font-bold prose-p:leading-relaxed prose-li:leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {message.thinkingContent && (
                <ThinkingSection content={message.thinkingContent} isActive={message.isThinkingActive} />
              )}
              {imagePrompt ? (
                <GeneratedImageCard prompt={imagePrompt} />
              ) : message.isStreaming && message.content ? (
                <ParticleText text={message.content} active />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {message.content}
                </ReactMarkdown>
              )}
              {suggestedExportFormat && (
                <DocumentDownloadAction
                  format={suggestedExportFormat}
                  exporting={exporting}
                  exportError={message.exportError}
                  onExport={handleExport}
                />
              )}
              {isLast && message.content === '' && !message.thinkingContent && (
                <ThinkingPlaceholder />
              )}
            </div>
          ) : null}
        </div>

        {/* Actions */}
        {!isUser && message.content && (
          <div className="flex items-center gap-1 mt-1.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button onClick={handleCopy} className="p-1.5 rounded-lg transition-all hover:scale-110" style={{ color: copied ? '#10b981' : 'var(--text-tertiary)' }} title="Copy">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button onClick={handleSpeak} className="p-1.5 rounded-lg transition-all hover:scale-110" style={{ color: speaking ? 'var(--accent)' : 'var(--text-tertiary)' }} title="Read aloud">
              {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <div className="relative">
              <button 
                onClick={() => setShowExportMenu(!showExportMenu)} 
                className="p-1.5 rounded-lg transition-all hover:scale-110" 
                style={{ color: exporting ? 'var(--accent)' : 'var(--text-tertiary)' }} 
                title="Export"
                disabled={exporting}
              >
                <Download size={13} />
              </button>
              {showExportMenu && (
                <div 
                  className="absolute left-0 top-full mt-1 py-1 rounded-lg shadow-lg z-50 min-w-[100px]" 
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}
                >
                  <button 
                    onClick={() => handleExport('pdf')} 
                    className="w-full px-3 py-1.5 text-left text-xs hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    PDF
                  </button>
                  <button 
                    onClick={() => handleExport('docx')} 
                    className="w-full px-3 py-1.5 text-left text-xs hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    DOCX
                  </button>
                  <button 
                    onClick={() => handleExport('pptx')} 
                    className="w-full px-3 py-1.5 text-left text-xs hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    PPTX
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--avatar-bg)', color: 'var(--btn-primary-text)' }}>
            <User size={14} />
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MessageBubble);

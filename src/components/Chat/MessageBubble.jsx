import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Copy, Check, Volume2, VolumeX, User, FileText, FileCode, File, X, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';

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
      <ExternalLink size={12} style={{ color: 'var(--text-tertiary)' }} />
    </div>
  );
}

function ThinkingSection({ content, isActive }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isActive]);

  if (!content) return null;

  if (isActive) {
    return (
      <div className="thinking-section mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="thinking-sparkle">✦</span>
          <span className="text-xs font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
            Thinking
          </span>
          <span className="flex gap-0.5 ml-1">
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '0s' }} />
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '0.2s' }} />
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '0.4s' }} />
          </span>
        </div>
        <div ref={scrollRef} className="thinking-scroll">
          <p className="thinking-smoke-text">{content}</p>
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

function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

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
    const utter = new SpeechSynthesisUtterance(message.content);
    utter.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  }, [message.content, speaking]);

  const markdownComponents = useMemo(() => ({
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      if (!inline && match) {
        return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
      }
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
  }), []);

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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
              {isLast && message.content === '' && !message.thinkingContent && (
                <div className="flex items-center gap-2 py-1">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-tertiary)' }} />
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-tertiary)', animationDelay: '0.15s' }} />
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-tertiary)', animationDelay: '0.3s' }} />
                  </div>
                </div>
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

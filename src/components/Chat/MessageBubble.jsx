import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, FileText, FileCode, File, X, ExternalLink, Download, RefreshCw, Pencil, Globe, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import MindMap from './MindMap';
import Chart from './Chart';
import ParticleText from './ParticleText';
import RelatedMedia from './RelatedMedia';
import UserAvatar from '../common/UserAvatar';
import { exportDocument, sanitizeDocumentContent } from '../../utils/documentExport';

const IMAGE_GEN_PATTERN = /\[IMAGE_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const VIDEO_GEN_PATTERN = /\[VIDEO_GEN(?:\:\s*|\]\s*)([\s\S]*?)(?:\]|$)/i;
const NSFW_PROMPT_PATTERN = /\b(nude|nudity|naked|explicit|erotic|porn|pornographic|xxx|18\+|lewd|nsfw|genitals?|penis|vagina|sex|sexual|breasts?|nipples?)\b/i;

function extractImagePrompt(content = '') {
  const match = String(content).match(IMAGE_GEN_PATTERN);
  return match?.[1]?.trim() || '';
}

function extractVideoPrompt(content = '') {
  const match = String(content).match(VIDEO_GEN_PATTERN);
  return match?.[1]?.trim() || '';
}

function enhanceImagePrompt(prompt = '') {
  const base = String(prompt).trim();
  if (!base) return base;
  // Keep realism cues short — Pollinations rejects pathologically long URLs
  // and longer prompts also slow generation / increase failure rate.
  const lower = base.toLowerCase();
  const realismCues = [
    'photorealistic',
    'ultra-detailed',
    'natural lighting',
    '8k',
  ];
  const missing = realismCues.filter((cue) => !lower.includes(cue));
  if (!missing.length) return base;
  return `${base}, ${missing.join(', ')}`;
}

const MAX_TRANSIENT_RETRIES = 0; // server already retries upstream; avoid client-side request storms
const MAX_FULL_RETRY_CYCLES = 1; // one extra full pass before hard failure
const GENERATED_IMAGE_SIZE = '1280';
const GENERATED_VIDEO_DURATION = '5';
const GENERATED_VIDEO_RESOLUTION = '1080p';
const MAX_GENERATED_PROMPT_CHARS = 900;

function compactImagePrompt(prompt = '') {
  const compact = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_GENERATED_PROMPT_CHARS) return compact;
  return compact.slice(0, MAX_GENERATED_PROMPT_CHARS).replace(/\s+\S*$/, '').trim();
}

function buildGeneratedImageUrl(prompt, cacheKey = '0-0') {
  const enhanced = compactImagePrompt(enhanceImagePrompt(prompt));
  const seed = Math.abs(hashString(enhanced)) % 1000000;
  const params = new URLSearchParams({
    prompt: enhanced,
    width: GENERATED_IMAGE_SIZE,
    height: GENERATED_IMAGE_SIZE,
    seed: String(seed),
    r: cacheKey,
  });
  return `/api/generate-image?${params.toString()}`;
}

function buildStoredImageProxyUrl(url = '', cacheKey = '0') {
  const params = new URLSearchParams({ url: String(url || ''), r: String(cacheKey || '0') });
  return `/api/image?${params.toString()}`;
}

function buildGeneratedVideoUrl(prompt, cacheKey = '0') {
  const enhanced = compactImagePrompt(prompt);
  const params = new URLSearchParams({
    prompt: enhanced,
    model: 'wan-pro',
    duration: GENERATED_VIDEO_DURATION,
    resolution: GENERATED_VIDEO_RESOLUTION,
    r: cacheKey,
  });
  return `/api/generate-video?${params.toString()}`;
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

function normalizeMarkdownForDisplay(content = '') {
  const raw = String(content || '');
  if (!raw) return '';
  // Avoid touching fenced code blocks.
  if (raw.includes('```')) return raw;

  const hasListMarkers = /(?:^|\s)(?:\d+\.\s+|[-*]\s+)/m.test(raw);
  if (!hasListMarkers) return raw;

  let normalized = raw.replace(/\r\n?/g, '\n');
  // Promote inline heading separators into block markdown.
  normalized = normalized.replace(/\s+---\s+(?=#{1,6}\s)/g, '\n\n---\n\n');
  normalized = normalized.replace(/([^\n])\s+(#{1,6}\s+)/g, '$1\n\n$2');
  // Break inline numbered points into separate markdown lines.
  normalized = normalized.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n$2');
  // Break inline bullet points into separate markdown lines.
  normalized = normalized.replace(/([^\n])\s+-\s+(?=[A-Z0-9*])/g, '$1\n- ');

  return normalized;
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
  return sanitizeDocumentContent(content);
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
      className="mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all hover:opacity-80"
      style={{
        background: 'color-mix(in srgb, currentColor 8%, transparent)',
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
        color: 'currentColor',
      }}
      onClick={() => {
        if (attachment.base64) {
          const a = document.createElement('a');
          a.href = attachment.base64;
          a.download = attachment.name;
          a.click();
        }
      }}
    >
      <Icon size={16} style={{ color: 'currentColor', opacity: 0.85 }} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium truncate block" style={{ color: 'currentColor' }}>{attachment.name}</span>
        <span className="text-[10px]" style={{ color: 'currentColor', opacity: 0.6 }}>{attachment.type}</span>
      </div>
      {isParsed && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>parsed</span>
      )}
      {parseFailed && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>unread</span>
      )}
      <ExternalLink size={12} style={{ color: 'currentColor', opacity: 0.55 }} />
    </div>
  );
}

function hostFromUrl(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function WebPageCapsule({ page }) {
  const [iconFailed, setIconFailed] = useState(false);
  if (!page) return null;
  const host = hostFromUrl(page.url);
  return (
    <div
      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-xs"
      style={{ background: 'rgba(255,255,255,0.58)', color: 'var(--user-bubble-text)', border: '1px solid rgba(255,255,255,0.7)' }}
      title={page.url || page.title || ''}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/80">
        {page.favicon && !iconFailed ? (
          <img
            src={page.favicon}
            alt=""
            className="h-4 w-4 object-contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Globe size={13} style={{ color: 'var(--accent)' }} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{page.action || 'Summarize this page'}</span>
        <span className="block truncate opacity-75">{page.title || host || page.url}</span>
      </span>
    </div>
  );
}

function ThinkingSection({ content, isActive }) {
  const [expanded, setExpanded] = useState(Boolean(isActive));
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

  useEffect(() => {
    setExpanded(Boolean(isActive));
  }, [isActive]);

  if (!content) return null;

  return (
    <div className={`thinking-section${isActive ? ' thinking-active' : ''}`} aria-live={isActive ? 'polite' : undefined}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="thinking-toggle"
        aria-expanded={expanded}
      >
        <span className="thinking-label">{isActive ? 'Thinking' : 'Thought process'}</span>
        {isActive && !expanded && <span className="thinking-live-dot" />}
      </button>

      <div className={`thinking-body${expanded ? ' is-expanded' : ''}`}>
        <div ref={scrollRef} className="thinking-scroll">
          <div className="thinking-lines">
            {lines.map((line, i) => (
              <div key={`${i}-${line}`} className="thinking-line">
                <span className={`thinking-line-text${isActive && i >= lines.length - 2 ? ' is-ghosting' : ''}`}>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SEARCHING_PHRASES = [
  'Surfing the internet…',
  'Reading fresh sources…',
  'Cross-checking results…',
  'Pulling the latest from the web…',
  'Scanning trusted publications…',
];

function SearchingPlaceholder() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * SEARCHING_PHRASES.length));
  useEffect(() => {
    const t = setInterval(() => setIdx((n) => (n + 1) % SEARCHING_PHRASES.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="searching-placeholder not-prose">
      <span className="searching-placeholder-icon" aria-hidden="true">
        <Globe size={14} />
      </span>
      <span className="searching-placeholder-text">{SEARCHING_PHRASES[idx]}</span>
      <span className="searching-placeholder-dots" aria-hidden="true">
        <i /><i /><i />
      </span>
    </div>
  );
}

function GeneratedImageCard({ prompt, image }) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [transientAttempt, setTransientAttempt] = useState(0);
  const [fullRetryCycle, setFullRetryCycle] = useState(0);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [open, setOpen] = useState(false);
  const imageMarkedNsfw = Boolean(
    image?.nsfw
    || String(image?.safety || '').toLowerCase() === 'unsafe'
    || NSFW_PROMPT_PATTERN.test(String(prompt || ''))
  );
  const [blurred, setBlurred] = useState(imageMarkedNsfw);
  const transientTimerRef = useRef(null);
  const persistedImageUrl = typeof image?.url === 'string' ? image.url.trim() : '';
  const hasPersistedImage = Boolean(persistedImageUrl);
  const [persistedLoadMode, setPersistedLoadMode] = useState('direct'); // 'direct' | 'proxy'
  const [persistedRetryNonce, setPersistedRetryNonce] = useState(0);

  const generatedImageUrl = useMemo(
    () => buildGeneratedImageUrl(prompt, `${retryNonce}-${transientAttempt}`),
    [prompt, retryNonce, transientAttempt]
  );

  const persistedImageSource = useMemo(() => {
    if (!hasPersistedImage) return '';
    if (persistedLoadMode === 'proxy') {
      return buildStoredImageProxyUrl(persistedImageUrl, persistedRetryNonce);
    }
    const divider = persistedImageUrl.includes('?') ? '&' : '?';
    return `${persistedImageUrl}${divider}r=${persistedRetryNonce}`;
  }, [hasPersistedImage, persistedImageUrl, persistedLoadMode, persistedRetryNonce]);

  const imageUrl = useMemo(
    () => (hasPersistedImage ? persistedImageSource : generatedImageUrl),
    [hasPersistedImage, persistedImageSource, generatedImageUrl]
  );

  useEffect(() => {
    setPersistedLoadMode('direct');
    setPersistedRetryNonce(0);
  }, [hasPersistedImage, persistedImageUrl]);

  // Reset to loading whenever we point at a new URL
  useEffect(() => {
    setStatus('loading');
  }, [imageUrl]);

  useEffect(() => {
    setBlurred(imageMarkedNsfw);
  }, [imageMarkedNsfw, imageUrl]);

  // Clear any pending retry timer when the component unmounts.
  useEffect(() => () => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
  }, []);

  const handleImgError = useCallback(() => {
    if (hasPersistedImage) {
      // Never regenerate older images. If the direct blob URL fails, retry once
      // through the image proxy to avoid CDN/CORS edge failures.
      if (persistedLoadMode === 'direct') {
        setPersistedLoadMode('proxy');
        setStatus('loading');
        return;
      }
      setStatus('error');
      return;
    }
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    // First, retry the same URL a couple times with backoff — Pollinations
    // frequently 502s on cold-start and succeeds on the second hit.
    if (transientAttempt < MAX_TRANSIENT_RETRIES) {
      const delay = 1000 + (transientAttempt * 900);
      transientTimerRef.current = setTimeout(() => {
        setTransientAttempt((n) => n + 1);
      }, delay);
      return;
    }
    // The server already rotates through Pollinations' live model registry.
    // Run one delayed full retry before failing the card.
    if (fullRetryCycle < MAX_FULL_RETRY_CYCLES) {
      const delay = 2000 + (fullRetryCycle * 2200);
      transientTimerRef.current = setTimeout(() => {
        setTransientAttempt(0);
        setRetryNonce((n) => n + 1);
        setFullRetryCycle((n) => n + 1);
      }, delay);
      return;
    }

    setStatus('error');
  }, [fullRetryCycle, hasPersistedImage, persistedLoadMode, transientAttempt]);

  const handleImgLoad = useCallback(() => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    setFullRetryCycle(0);
    setStatus('ready');
  }, []);

  const handleRetry = useCallback(() => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    if (hasPersistedImage) {
      setPersistedLoadMode('direct');
      setPersistedRetryNonce((n) => n + 1);
      setStatus('loading');
      return;
    }
    setTransientAttempt(0);
    setFullRetryCycle(0);
    setRetryNonce((n) => n + 1);
  }, [hasPersistedImage]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="generated-image-card not-prose">
      <div
        className={`generated-image-frame status-${status}`}
        onClick={() => {
          if (status !== 'ready') return;
          if (blurred) { setBlurred(false); return; }
          setOpen(true);
        }}
        role={status === 'ready' ? 'button' : undefined}
        tabIndex={status === 'ready' ? 0 : -1}
        onKeyDown={(e) => {
          if (status === 'ready' && (e.key === 'Enter' || e.key === ' ')) {
            if (blurred) setBlurred(false); else setOpen(true);
          }
        }}
        style={{ cursor: status === 'ready' ? 'pointer' : 'default' }}
      >
        {status !== 'error' && (
          <img
            key={imageUrl}
            src={imageUrl}
            alt=""
            loading="lazy"
            onLoad={handleImgLoad}
            onError={handleImgError}
            style={{ opacity: status === 'ready' ? 1 : 0, filter: blurred && status === 'ready' ? 'blur(22px)' : 'none', transition: 'filter 0.4s ease' }}
          />
        )}

        {status === 'ready' && blurred && (
          <div className="generated-image-blur-overlay">
            <div className="generated-image-blur-icon"><EyeOff size={28} strokeWidth={1.5} /></div>
            <span className="generated-image-blur-label">Click to reveal</span>
            <span className="generated-image-blur-sub">Sensitive content — blurred by default</span>
          </div>
        )}

        {status === 'loading' && (
          <div className="generated-image-loader">
            <div className="generated-image-spinner" />
            <span>Generating image…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="generated-image-loader generated-image-errored">
            <span>Image failed to generate.</span>
            <button type="button" onClick={handleRetry} className="generated-image-retry">
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="generated-image-meta">
        <span className="generated-image-label">Generated image</span>
        <p>{prompt}</p>
        {status === 'ready' && blurred && (
          <button type="button" onClick={() => setBlurred(false)} className="generated-image-open">
            Click to reveal image
          </button>
        )}
        {status === 'ready' && !blurred && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setOpen(true)} className="generated-image-open">
              Open full image
            </button>
            <button type="button" onClick={() => setBlurred(true)} className="generated-image-open" style={{ opacity: 0.6 }}>
              Re-blur
            </button>
          </div>
        )}
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="image-lightbox"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Generated image preview"
        >
          <div
            className="image-lightbox-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="image-lightbox-header">
              <div className="image-lightbox-badge">
                <span className="image-lightbox-dot" />
                Generated image
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="image-lightbox-close"
                aria-label="Close preview"
              >
                <X size={16} />
              </button>
            </div>

            <div className="image-lightbox-body">
              <img
                src={imageUrl}
                alt={prompt}
                className="image-lightbox-img"
              />
            </div>

            <div className="image-lightbox-footer">
              <p className="image-lightbox-prompt" title={prompt}>{prompt}</p>
              <a
                href={imageUrl}
                download={`generated-${Date.now()}.jpg`}
                target="_blank"
                rel="noopener noreferrer"
                className="image-lightbox-download"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={14} />
                Download
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function GeneratedVideoCard({ prompt }) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  const videoUrl = useMemo(
    () => buildGeneratedVideoUrl(prompt, String(retryNonce)),
    [prompt, retryNonce]
  );

  useEffect(() => {
    setStatus('loading');
  }, [videoUrl]);

  const handleRetry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  return (
    <div className="generated-image-card generated-video-card not-prose">
      <div className={`generated-image-frame generated-video-frame status-${status}`}>
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          onCanPlay={() => setStatus('ready')}
          onError={() => setStatus('error')}
          style={{ opacity: status === 'ready' ? 1 : 0 }}
        />

        {status === 'loading' && (
          <div className="generated-image-loader">
            <div className="generated-image-spinner" />
            <span>Generating video…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="generated-image-loader generated-image-errored">
            <span>Video failed to generate.</span>
            <button type="button" onClick={handleRetry} className="generated-image-retry">
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="generated-image-meta">
        <span className="generated-image-label">Generated video</span>
        <p>{prompt}</p>
        {status === 'ready' && (
          <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="generated-image-open">
            Open video in new tab
          </a>
        )}
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
        {exportError || 'Ready to download.'}
      </span>
    </div>
  );
}

function EditPromptModal({ open, initialValue, onClose, onSave }) {
  const [value, setValue] = useState(initialValue || '');

  useEffect(() => {
    if (open) {
      setValue(initialValue || '');
    }
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(); }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') handleResend();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, value]);

  function handleResend() {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[350] flex items-center justify-center p-4"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-3xl p-5 glass-strong shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Edit message</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Ctrl/Cmd + Enter to resend</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:opacity-80" style={{ color: 'var(--text-tertiary)' }}>
            <X size={18} />
          </button>
        </div>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
          style={{ background: 'var(--glass-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />

        <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResend}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              Resend
            </button>
          </div>
        </div>
      </div>

    </div>,
    document.body
  );
}

function MessageBubble({ message, isLast, onRetry, onEdit, webSearch = false, isSearching = false, userProfile = null }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const imagePrompt = !isUser ? extractImagePrompt(message.content) : '';
  const videoPrompt = !isUser ? extractVideoPrompt(message.content) : '';
  const showThinking = !isUser && Boolean(message.thinkingContent);
  const searchingBubbleActive = !isUser && isLast && isSearching && message.content === '' && !showThinking;
  const thinkingOnly = Boolean(message.isThinkingActive && showThinking && !message.content);
  const suggestedExportFormat = !isUser && !message.isStreaming && !imagePrompt && !videoPrompt
    ? getSuggestedExportFormat(message)
    : '';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

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

  const handleRetry = useCallback(() => {
    if (!isUser || typeof onRetry !== 'function') return;
    onRetry(message, webSearch);
  }, [isUser, message, onRetry, webSearch]);

  const handleEditSave = useCallback((nextValue) => {
    if (!isUser || typeof onEdit !== 'function') return;
    const trimmed = String(nextValue || '').trim();
    if (!trimmed) return;
    setShowEditModal(false);
    onEdit(message, trimmed, webSearch);
  }, [isUser, message, onEdit, webSearch]);

  const formattedMarkdownContent = useMemo(
    () => normalizeMarkdownForDisplay(message.content),
    [message.content]
  );

  const markdownComponents = useMemo(() => ({
    img({ src, alt }) {
      const s = typeof src === 'string' ? src.trim() : '';

      // If markdown produces an empty url, don't render an <img> with empty src.
      if (!s) return null;

      // Accept already-valid sources: data: URIs, http(s) URLs, blob: URLs,
      // protocol-relative URLs and root/relative paths. Only treat as raw
      // base64 if the string contains no scheme/path indicators.
      let finalSrc;
      if (/^(data:|https?:\/\/|blob:|\/\/|\/)/i.test(s)) {
        finalSrc = s;
      } else if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 64) {
        // Looks like raw base64 (no URL chars) — wrap as PNG data URI.
        finalSrc = `data:image/png;base64,${s.replace(/\s+/g, '')}`;
      } else {
        // Unknown/invalid src — skip rendering rather than producing a broken image.
        return null;
      }

      return (
        <img
          src={finalSrc}
          alt={alt || 'Generated Image'}
          className="rounded-xl my-3 max-w-full shadow-lg"
          style={{ maxHeight: '512px', objectFit: 'contain' }}
          loading="lazy"
          onError={(e) => {
            const el = e.currentTarget;
            // For remote URLs, try the server-side image proxy once before giving up.
            if (/^https?:\/\//i.test(finalSrc) && !el.dataset.proxied) {
              el.dataset.proxied = '1';
              el.src = `/api/image?url=${encodeURIComponent(finalSrc)}`;
              return;
            }
            // Hide broken image and show message
            el.style.display = 'none';
            const msg = document.createElement('div');
            msg.className = 'text-sm py-3 px-4 rounded-xl my-2';
            msg.style.cssText = 'background: var(--glass-bg); color: var(--text-tertiary);';
            msg.textContent = 'Image failed to load.';
            el.parentNode.insertBefore(msg, el.nextSibling);
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
    ul({ children }) {
      return <ul className="my-3 space-y-1 pl-6" style={{ listStyleType: 'disc' }}>{children}</ul>;
    },
    ol({ children }) {
      return <ol className="my-3 space-y-1 pl-6" style={{ listStyleType: 'decimal' }}>{children}</ol>;
    },
    li({ children }) {
      return <li className="pl-1" style={{ color: 'var(--text-primary)' }}>{children}</li>;
    },
  }), [handleExport, suggestedExportFormat]);

  return (
    <div className={`group flex gap-3 px-4 lg:px-0 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      <div className={`${isUser ? 'max-w-[88%] sm:max-w-[84%]' : 'max-w-[920px] min-w-0'}`}>
        {isUser ? (
          <div
            className="hud-chat-bubble hud-chat-bubble-user"
            style={{ color: 'var(--user-bubble-text)' }}
          >
            {message.content && (
              <p className="whitespace-pre-wrap break-words overflow-x-auto max-w-full" style={{ lineHeight: 1.6 }}>{message.content}</p>
            )}
            {message.webPage && (
              <WebPageCapsule page={message.webPage} />
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="space-y-1">
                {message.attachments.map((att, idx) => (
                  <AttachmentPreview key={idx} attachment={att} />
                ))}
              </div>
            )}
          </div>
        ) : message.type === 'image_loading' ? (
          <div className="hud-chat-bubble hud-chat-bubble-assistant">
            <div className="hud-chat-bubble-label">MIRA · RENDERING</div>
            <div className="w-64 h-64 rounded-md overflow-hidden relative" style={{ background: '#02080e' }}>
              <div className="absolute w-40 h-40 rounded-full blur-2xl animate-[blobMove1_2s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(94,234,212,0.55)', top: '-10%', left: '-10%' }} />
              <div className="absolute w-36 h-36 rounded-full blur-2xl animate-[blobMove2_2.4s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(34,211,238,0.5)', bottom: '-10%', right: '-10%' }} />
              <div className="absolute w-32 h-32 rounded-full blur-3xl animate-[blobMove3_1.8s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(59,130,246,0.5)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
              <div className="absolute w-28 h-28 rounded-full blur-2xl animate-[blobMove4_2.2s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(125,211,252,0.4)', top: '20%', right: '10%' }} />
              <div className="absolute w-24 h-24 rounded-full blur-xl animate-[blobMove5_1.6s_ease-in-out_infinite_alternate]" style={{ background: 'rgba(94,234,212,0.5)', bottom: '15%', left: '15%' }} />
            </div>
          </div>
        ) : (
          <div className={`hud-chat-bubble hud-chat-bubble-assistant${thinkingOnly ? ' is-thinking-only' : ''}${(!thinkingOnly && (message.isStreaming || searchingBubbleActive)) ? ' is-active' : ''}`}>
            <div className="hud-chat-bubble-label">
              {searchingBubbleActive ? 'MIRA · SEARCHING' : message.isThinkingActive ? 'MIRA · THINKING' : message.isStreaming ? 'MIRA · RESPONDING' : 'MIRA'}
            </div>
            <div className="prose prose-base max-w-none overflow-x-auto break-words prose-headings:font-bold prose-p:leading-relaxed prose-li:leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {showThinking && (
                <ThinkingSection content={message.thinkingContent} isActive={message.isThinkingActive} />
              )}
              {message.image && message.image.length > 0 && (
                <img src={message.image} alt="Generated" className="rounded-xl mb-3 max-w-full shadow-lg" />
              )}
              {imagePrompt ? (
                <GeneratedImageCard prompt={imagePrompt} image={message.generatedMedia?.images?.[0]} />
              ) : videoPrompt ? (
                <GeneratedVideoCard prompt={videoPrompt} />
              ) : message.isStreaming && message.content ? (
                <ParticleText text={message.content} active />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {formattedMarkdownContent}
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
              {message.media && !message.isStreaming && (
                <RelatedMedia media={message.media} />
              )}
              {isLast && message.content === '' && !message.thinkingContent && isSearching && (
                <SearchingPlaceholder />
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {isUser && message.content && (
          <div className="flex items-center gap-1 mt-1.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 justify-end">
            <button onClick={() => setShowEditModal(true)} className="p-1.5 rounded-md transition-all hover:scale-110" style={{ color: 'var(--hud-cyan-soft)' }} title="Edit and resend">
              <Pencil size={13} />
            </button>
            <button onClick={handleRetry} className="p-1.5 rounded-md transition-all hover:scale-110" style={{ color: 'var(--hud-cyan-soft)' }} title="Retry">
              <RefreshCw size={13} />
            </button>
          </div>
        )}
        {!isUser && message.content && (
          <div className="flex items-center gap-1 mt-1.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button onClick={handleCopy} className="p-1.5 rounded-md transition-all hover:scale-110" style={{ color: copied ? '#5eead4' : 'var(--hud-cyan-soft)' }} title="Copy">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1.5 rounded-md transition-all hover:scale-110"
                style={{ color: exporting ? 'var(--hud-cyan-bright)' : 'var(--hud-cyan-soft)' }}
                title="Export"
                disabled={exporting}
              >
                <Download size={13} />
              </button>
              {showExportMenu && (
                <div
                  className="absolute left-0 top-full mt-1 py-1 rounded-md shadow-lg z-50 min-w-[100px]"
                  style={{ background: 'var(--hud-bg)', border: '1px solid var(--hud-cyan-dim)' }}
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
        <EditPromptModal open={showEditModal} initialValue={message.content} onClose={() => setShowEditModal(false)} onSave={handleEditSave} />
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <UserAvatar profile={userProfile} size={32} className="shadow-sm" title="You" />
        </div>
      )}
    </div>
  );
}

export default memo(MessageBubble);

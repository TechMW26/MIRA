import { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Paperclip, X, FileText, Image as ImageIcon, FileCode, File, Loader,
  Globe, Code2, Zap, Wrench, BookMarked, Share2, Cpu, ChevronDown, Lock, AlertTriangle,
} from 'lucide-react';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';
import { useChatContext } from '../../contexts/ChatContext';

const ACCEPT_TYPES = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,.heic,.sh,.rs,.go,.rb,.php,.sql';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return ImageIcon;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'html', 'css'].includes(ext)) return FileCode;
  if (['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getExt(name = '') {
  return name.split('.').pop().toLowerCase();
}

function mimeFromName(name = '') {
  const ext = getExt(name);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (IMAGE_EXTS.has(ext)) return `image/${ext}`;
  return '';
}

function isImageFile(file) {
  return file?.type?.startsWith('image/') || IMAGE_EXTS.has(getExt(file?.name || ''));
}

function normalizeImageDataUrl(dataUrl, mimeType) {
  if (!mimeType || !dataUrl.startsWith('data:application/octet-stream;base64,')) return dataUrl;
  return dataUrl.replace('data:application/octet-stream;base64,', `data:${mimeType};base64,`);
}

function namedClipboardFile(file) {
  if (file.name && file.name !== 'image.png') return file;
  const mimeType = file.type || 'image/png';
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return new File([file], `pasted-image-${Date.now()}.${ext}`, { type: mimeType });
}

function dataUrlToFile(dataUrl) {
  const mimeType = dataUrl.match(/^data:([^;,]+)/)?.[1] || 'image/png';
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return fetch(dataUrl)
    .then((res) => res.blob())
    .then((blob) => new File([blob], `dropped-image-${Date.now()}.${ext}`, { type: mimeType }));
}

async function imageUrlToFile(url) {
  if (!url) return null;
  if (url.startsWith('data:image/')) return dataUrlToFile(url);
  if (!/^https?:\/\//i.test(url)) return null;
  const cleanUrl = url.trim();
  const extension = getExt(cleanUrl.split('?')[0].split('#')[0]);
  if (!IMAGE_EXTS.has(extension)) return null;
  const response = await fetch(cleanUrl);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') && !IMAGE_EXTS.has(extension)) return null;
  const filename = decodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || `dropped-image.${extension || 'png'}`);
  return new File([blob], filename, { type: blob.type || mimeFromName(filename) || 'image/png' });
}

function getImageUrlsFromDataTransfer(dataTransfer) {
  const urls = new Set();
  const uriList = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '';
  uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => urls.add(line));

  const html = dataTransfer.getData('text/html') || '';
  const imgMatch = html.match(/<img\b[^>]*src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) urls.add(imgMatch[1]);
  return [...urls];
}

function hasFileLikeDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
}

function getClipboardImageFiles(clipboard) {
  const candidates = [
    ...Array.from(clipboard?.files || []),
    ...Array.from(clipboard?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean),
  ];
  const seen = new Set();
  return candidates
    .filter(isImageFile)
    .map(namedClipboardFile)
    .filter((file) => {
      const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export default function ChatInput({ onSend, onStop, isGenerating, isSearching, webSearch, onToggleWebSearch, activePanel, onTogglePanel, onShare, messages }) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [lockedPinOpen, setLockedPinOpen] = useState(false);
  const [lockedPinInput, setLockedPinInput] = useState('');
  const [lockedPinError, setLockedPinError] = useState('');
  const { selectedModel, setSelectedModel, lockedModelUnlocked, setLockedModelUnlocked, LOCKED_MODEL_PIN } = useChatContext();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const selectedModelLabel = selectedModel === 'locked'
    ? 'Mira Locked'
    : selectedModel === 'mira-pro'
      ? 'Mira Pro'
      : selectedModel === 'mira-lite'
        ? 'Mira Lite'
        : selectedModel === 'mira'
          ? 'Mira'
          : 'Auto';

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
    }
  }, [input]);

  function handleSubmit(e) {
    e?.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isGenerating) return;
    onSend(input.trim(), attachments);
    setInput('');
    setAttachments([]);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function processFiles(files) {
    const fileList = files.filter(Boolean);
    if (!fileList.length) return;
    setParsing(true);
    try {
      const processed = (await Promise.all(
        fileList.map(async (file) => {
          const isImage = isImageFile(file);
          const mimeType = file.type || mimeFromName(file.name);
          const rawBase64 = await readFileAsBase64(file);
          const base64 = isImage ? normalizeImageDataUrl(rawBase64, mimeType) : rawBase64;
          if (isImage) return { name: file.name, size: file.size, type: mimeType, isImage: true, base64, mimeType };
          let text = '';
          let parseError = '';
          if (isExtractableFile(file)) {
            try {
              text = await extractFileText(file) || '';
            } catch (error) {
              parseError = error?.message || 'Could not read this file.';
            }
          }
          return { name: file.name, size: file.size, type: mimeType, isImage: false, text, base64, mimeType, parsed: !!text, parseError };
        })
      )).filter(Boolean);
      if (processed.length) setAttachments((prev) => [...prev, ...processed]);
    } finally {
      setParsing(false);
    }
  }

  async function handleFiles(e) {
    await processFiles(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function processDropPayload(dataTransfer) {
    const files = Array.from(dataTransfer.files || []);
    const urlFiles = await Promise.allSettled(
      getImageUrlsFromDataTransfer(dataTransfer).map((url) => imageUrlToFile(url))
    );
    const droppedImages = urlFiles
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    await processFiles([...files, ...droppedImages]);
  }

  async function handlePaste(e) {
    const clipboard = e.clipboardData;
    if (!clipboard) return;
    const imageFiles = getClipboardImageFiles(clipboard);
    if (imageFiles.length) {
      e.preventDefault?.();
      textareaRef.current?.focus();
      await processFiles(imageFiles);
    }
  }

  useEffect(() => {
    const handleDocumentPaste = (event) => {
      handlePaste(event);
    };

    document.addEventListener('paste', handleDocumentPaste, true);
    return () => {
      document.removeEventListener('paste', handleDocumentPaste, true);
    };
  }, []);

  function onDragEnter(e) {
    if (!hasFileLikeDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragging(true);
  }

  function onDragLeave(e) {
    if (!hasFileLikeDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setDragging(false);
  }

  function onDragOver(e) {
    if (!hasFileLikeDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  async function onDrop(e) {
    if (!hasFileLikeDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragging(false);
    await processDropPayload(e.dataTransfer);
  }

  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  const toolStrip = [
    { id: 'web', icon: Globe, title: 'Web search', active: webSearch, onClick: onToggleWebSearch },
    { id: 'canvas', icon: Code2, title: 'Canvas', active: activePanel === 'canvas', onClick: () => onTogglePanel('canvas') },
    { id: 'tasks', icon: Zap, title: 'Tasks', active: activePanel === 'tasks', onClick: () => onTogglePanel('tasks') },
    { id: 'tools', icon: Wrench, title: 'Tools', active: activePanel === 'tools', onClick: () => onTogglePanel('tools') },
    { id: 'prompts', icon: BookMarked, title: 'Prompts', active: activePanel === 'prompts', onClick: () => onTogglePanel('prompts') },
  ];

  const hasShare = messages?.length > 0;

  return (
    <div className="hud-composer-dock mobile-composer-dock px-3 sm:px-6 lg:px-[180px] pb-3 sm:pb-5 pt-4 sm:pt-8 relative z-20">
      {selectedModel === 'locked' && (
        <div className="nsfw-banner max-w-2xl w-full mx-auto mb-2">
          <AlertTriangle size={13} />
          <span>Unrestricted mode active — Mira Locked model is engaged. Content may be explicit.</span>
          <button type="button" onClick={() => setSelectedModel('auto')} className="nsfw-banner-dismiss">Disable</button>
        </div>
      )}      
      <div className="max-w-2xl w-full mx-auto composer-mobile-shell">
        <div className="chat-input-wrap relative">
          <div
            className="hud-composer chat-input-shell"
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            style={{ flexDirection: 'column', alignItems: 'stretch', padding: '4px 8px 4px 18px' }}
          >
            <div className="hud-tool-strip hud-tool-strip-inside">
              {toolStrip.map(({ id, icon: Icon, title, active, onClick }) => (
                <button
                  key={id}
                  type="button"
                  onClick={onClick}
                  className="hud-tool"
                  data-active={active || undefined}
                  title={title}
                >
                  <Icon size={15} />
                  <span className="hud-tool-tip">{title}</span>
                </button>
              ))}

              {hasShare && (
                <button
                  type="button"
                  onClick={onShare}
                  className="hud-tool"
                  title="Share"
                >
                  <Share2 size={15} />
                  <span className="hud-tool-tip">Share</span>
                </button>
              )}
            </div>

            {dragging && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
                style={{
                  background: 'rgba(94, 234, 212, 0.08)',
                  border: '1px dashed var(--hud-cyan)',
                  borderRadius: 6,
                }}
              >
                <Paperclip size={22} style={{ color: 'var(--hud-cyan-bright)' }} />
                <p className="text-xs font-medium mt-2 tracking-[0.18em] uppercase" style={{ color: 'var(--hud-cyan-bright)' }}>
                  Drop files
                </p>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="hud-attachment-strip pt-3 pb-2">
                {attachments.map((att, i) => {
                  if (att.isImage) {
                    return (
                      <div key={i} className="relative rounded-md overflow-hidden animate-fade-in group" style={{ width: '64px', height: '64px', border: '1px solid var(--hud-cyan-dim)' }}>
                        <img src={att.base64} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeAttachment(i)}
                          className="absolute top-1 right-1 p-0.5 rounded-full transition-all opacity-0 group-hover:opacity-100"
                          style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  }
                  const Icon = getFileIcon(att.name);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs animate-fade-in"
                      style={{
                        color: 'var(--text-secondary)',
                        background: 'rgba(94, 234, 212, 0.05)',
                        border: '1px solid var(--hud-cyan-dim)',
                        borderRadius: 4,
                      }}
                    >
                      <Icon size={14} style={{ color: 'var(--hud-cyan)' }} />
                      <span className="max-w-[120px] truncate">{att.name}</span>
                      <span className="opacity-50">{formatFileSize(att.size)}</span>
                      <button onClick={() => removeAttachment(i)} className="p-0.5 rounded hover:scale-110 transition-all" style={{ color: 'var(--text-tertiary)' }}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-1 sm:gap-1.5 w-full">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message MIRA..."
                rows={1}
                className="hud-composer-textarea"
                style={{ padding: '12px 4px' }}
              />

              <div className="composer-model-wrap">
                <button
                  type="button"
                  onClick={() => setModelPickerOpen((v) => !v)}
                  className="composer-model-btn"
                  data-active={selectedModel !== 'auto' || modelPickerOpen || undefined}
                  title={`Model: ${selectedModelLabel}`}
                >
                  <Cpu size={14} />
                  <span className="hidden sm:inline">{selectedModelLabel}</span>
                  <ChevronDown size={14} className={`transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelPickerOpen && (
                  <div className="composer-model-popover" onMouseLeave={() => setModelPickerOpen(false)}>
                    <button type="button" className="composer-model-option" data-active={selectedModel === 'auto' || undefined} onClick={() => { setSelectedModel('auto'); setModelPickerOpen(false); }}>
                      <span>Auto</span>
                      <small>fast by default · escalates when needed</small>
                    </button>
                    <button type="button" className="composer-model-option" data-active={selectedModel === 'mira-lite' || undefined} onClick={() => { setSelectedModel('mira-lite'); setModelPickerOpen(false); }}>
                      <span>Mira Lite</span>
                      <small>fastest · ultra-low latency</small>
                    </button>
                    <button type="button" className="composer-model-option" data-active={selectedModel === 'mira' || undefined} onClick={() => { setSelectedModel('mira'); setModelPickerOpen(false); }}>
                      <span>Mira</span>
                      <small>standard</small>
                    </button>
                    <button type="button" className="composer-model-option" data-active={selectedModel === 'mira-pro' || undefined} onClick={() => { setSelectedModel('mira-pro'); setModelPickerOpen(false); }}>
                      <span>Mira Pro</span>
                      <small>chat + vision</small>
                    </button>
                    <div style={{ borderTop: '1px solid var(--hud-cyan-dim)', margin: '4px 0' }} />
                    <button
                      type="button"
                      className="composer-model-option"
                      data-active={selectedModel === 'locked' || undefined}
                      onClick={() => {
                        setModelPickerOpen(false);
                        setLockedPinInput('');
                        setLockedPinError('');
                        setLockedPinOpen(true);
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Lock size={12} style={{ color: 'var(--hud-cyan-soft)' }} />
                        Mira Locked
                      </span>
                      <small>unrestricted · pin required</small>
                    </button>
                  </div>
                )}
              </div>

              <input ref={fileInputRef} type="file" multiple accept={ACCEPT_TYPES} onChange={handleFiles} className="hidden" />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="composer-icon-btn"
                title="Attach files"
              >
                {parsing ? <Loader size={18} className="animate-spin" /> : <Paperclip size={18} />}
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="composer-send-btn"
                  style={{ background: 'rgba(244, 63, 94, 0.18)', color: '#fda4af' }}
                  title="Stop"
                >
                  <Square size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!input.trim() && attachments.length === 0}
                  className="composer-send-btn"
                  title="Send"
                >
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── PIN gate for Mira Locked (with inline disclaimer) ── */}
      {lockedPinOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(6px)' }} onClick={() => setLockedPinOpen(false)}>
          <div className="glass-strong rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)' }}>
                <Lock size={18} style={{ color: '#f87171' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Unlock Mira Locked</h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Unrestricted model — PIN required</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed mb-4 px-1" style={{ color: 'var(--text-tertiary)' }}>
              This model operates without content restrictions. By unlocking you confirm you are <strong>18+</strong> and
              accept responsibility for all generated content.
            </p>
            <input
              type="password"
              inputMode="numeric"
              value={lockedPinInput}
              onChange={(e) => { setLockedPinInput(e.target.value.replace(/\D/g, '')); setLockedPinError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (lockedPinInput === LOCKED_MODEL_PIN) {
                    setLockedModelUnlocked(true);
                    setLockedPinOpen(false);
                    setSelectedModel('locked');
                  } else {
                    setLockedPinError('Incorrect PIN');
                  }
                }
              }}
              placeholder="Enter PIN..."
              autoFocus
              maxLength={8}
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-center tracking-[0.5em] outline-none focus:ring-1 focus:ring-[var(--border)] mb-2"
              style={{ color: 'var(--text-primary)' }}
            />
            {lockedPinError && <p className="text-xs text-red-400 text-center mb-2">{lockedPinError}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => setLockedPinOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all" style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}>Cancel</button>
              <button
                onClick={() => {
                  if (lockedPinInput === LOCKED_MODEL_PIN) {
                    setLockedModelUnlocked(true);
                    setLockedPinOpen(false);
                    setSelectedModel('locked');
                  } else {
                    setLockedPinError('Incorrect PIN');
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}
              >Unlock &amp; Enable</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

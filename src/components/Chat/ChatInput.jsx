import { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Paperclip, X, FileText, Image as ImageIcon, FileCode, File, Loader,
  Globe, Code2, Zap, Wrench, BookMarked, Share2, ListPlus, CornerDownRight, Pencil, Check,
  Mic, MicOff,
} from 'lucide-react';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';
import {
  getClipboardImageFiles,
  getExt,
  IMAGE_EXTS,
  isImageFile,
  isSupportedImageUrl,
  mimeFromName,
} from '../../utils/imageFiles';

const ACCEPT_TYPES = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,.heic,.sh,.rs,.go,.rb,.php,.sql';
const MAX_IMAGES = 6;

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

function normalizeImageDataUrl(dataUrl, mimeType) {
  if (!mimeType || !dataUrl.startsWith('data:application/octet-stream;base64,')) return dataUrl;
  return dataUrl.replace('data:application/octet-stream;base64,', `data:${mimeType};base64,`);
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
  const cleanUrl = url.trim();
  if (!isSupportedImageUrl(cleanUrl)) return null;
  const extension = getExt(cleanUrl.split('?')[0].split('#')[0]);
  let response;
  try {
    response = await fetch(cleanUrl);
  } catch {
    response = null;
  }
  if (!response?.ok) {
    response = await fetch(`/api/image?url=${encodeURIComponent(cleanUrl)}`);
  }
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

export default function ChatInput({
  onSend,
  onQueue,
  onSteer,
  onStop,
  isGenerating,
  isConversationBusy = false,
  busyUser = null,
  isSearching,
  webSearch,
  onToggleWebSearch,
  activePanel,
  onTogglePanel,
  onShare,
  messages,
  queuedPrompts = [],
  queueLimitReached = false,
  onRemoveQueued,
  onEditQueued,
  onSendQueuedNow,
  onHeightChange,
  currentUserId = '',
  voiceActive = false,
  voiceStatus = 'idle',
  voiceStatusLabel = 'Voice mode',
  onToggleVoice,
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [editingQueuedId, setEditingQueuedId] = useState(null);
  const [editingQueuedContent, setEditingQueuedContent] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const dockRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
    }
  }, [input]);

  useEffect(() => {
    if (editingQueuedId && !queuedPrompts.some((prompt) => prompt.id === editingQueuedId)) {
      setEditingQueuedId(null);
      setEditingQueuedContent('');
    }
  }, [editingQueuedId, queuedPrompts]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock || !onHeightChange) return undefined;

    const reportHeight = () => onHeightChange(Math.ceil(dock.getBoundingClientRect().height));
    reportHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reportHeight);
      return () => window.removeEventListener('resize', reportHeight);
    }

    const observer = new ResizeObserver(reportHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [onHeightChange]);

  function beginQueuedEdit(prompt) {
    setEditingQueuedId(prompt.id);
    setEditingQueuedContent(prompt.content || '');
  }

  function cancelQueuedEdit() {
    setEditingQueuedId(null);
    setEditingQueuedContent('');
  }

  function saveQueuedEdit(prompt) {
    const content = editingQueuedContent.trim();
    if (!content && !prompt.attachments?.length) return;
    onEditQueued?.(prompt.id, content);
    cancelQueuedEdit();
  }

  function handleQueuedEditKeyDown(event, prompt) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelQueuedEdit();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveQueuedEdit(prompt);
    }
  }

  const queueMode = isGenerating || isConversationBusy;

  function handleSubmit(e, mode = queueMode ? 'queue' : 'send') {
    e?.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    if (mode === 'queue' && queueLimitReached) {
      setAttachmentNotice('The prompt queue is full. Remove one before adding another.');
      return;
    }
    if (mode === 'queue') onQueue?.(input.trim(), attachments);
    else if (mode === 'steer') onSteer?.(input.trim(), attachments);
    else onSend(input.trim(), attachments);
    setInput('');
    setAttachments([]);
    setAttachmentNotice('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const mode = isGenerating && (e.metaKey || e.ctrlKey) ? 'steer' : undefined;
      handleSubmit(undefined, mode);
    }
  }

  async function processFiles(files, source = 'files') {
    const availableImages = Math.max(0, MAX_IMAGES - attachments.filter((attachment) => attachment.isImage).length);
    let acceptedImages = 0;
    let skippedImages = 0;
    const fileList = files.filter(Boolean).filter((file) => {
      if (!isImageFile(file)) return true;
      if (acceptedImages >= availableImages) {
        skippedImages += 1;
        return false;
      }
      acceptedImages += 1;
      return true;
    });
    if (!fileList.length) {
      if (skippedImages) setAttachmentNotice(`MIRA supports up to ${MAX_IMAGES} images per message.`);
      return;
    }
    setParsing(true);
    try {
      const results = await Promise.allSettled(
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
      );
      const processed = results
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value);
      const failed = results.length - processed.length;
      if (processed.length) {
        setAttachments((prev) => [...prev, ...processed]);
        if (source === 'clipboard') {
          setAttachmentNotice(`${processed.length} pasted image${processed.length === 1 ? '' : 's'} attached.`);
        }
      }
      if (skippedImages) {
        setAttachmentNotice(`MIRA supports up to ${MAX_IMAGES} images per message.`);
      } else if (failed) {
        setAttachmentNotice(`${failed} file${failed === 1 ? '' : 's'} could not be attached.`);
      }
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
    let imageFiles = getClipboardImageFiles(clipboard);
    const imageUrls = imageFiles.length
      ? []
      : getImageUrlsFromDataTransfer(clipboard).filter(isSupportedImageUrl);
    if (!imageFiles.length && !imageUrls.length) return;

    e.preventDefault();
    textareaRef.current?.focus();

    if (imageUrls.length) {
      const results = await Promise.allSettled(imageUrls.map((url) => imageUrlToFile(url)));
      imageFiles = results
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value);
    }

    if (imageFiles.length) {
      await processFiles(imageFiles, 'clipboard');
    } else {
      setAttachmentNotice('That copied image could not be attached. Try downloading it first.');
    }
  }

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
    <div ref={dockRef} className="hud-composer-dock mobile-composer-dock px-3 sm:px-6 lg:px-[180px] pb-3 sm:pb-5 pt-4 sm:pt-8 relative z-20">
      <div className="max-w-2xl w-full mx-auto composer-mobile-shell">
        <div className="chat-input-wrap relative">
          {queuedPrompts.length > 0 && (
            <section className="queued-prompt-stack" role="region" aria-label="Queued prompts">
              <div className="queued-prompt-stack__header">
                <span className="queued-prompt-stack__title"><ListPlus size={13} /> Queued prompts</span>
                <span className="queued-prompt-stack__count">{queuedPrompts.length}</span>
              </div>
              <div className="queued-prompt-stack__list">
                {queuedPrompts.map((prompt, index) => {
                  const isEditing = editingQueuedId === prompt.id;
                  const attachmentCount = prompt.attachments?.length || 0;
                  const canManage = !prompt.author?.uid || prompt.author.uid === currentUserId;
                  const authorName = prompt.author?.displayName || prompt.author?.email || '';
                  return (
                    <article key={prompt.id} className="queued-prompt-card">
                      <div className="queued-prompt-card__topline">
                        <span className="queued-prompt-card__position">{index === 0 ? 'Next' : `Queued ${index + 1}`}</span>
                        <div className="queued-prompt-card__meta">
                          {authorName && <span>{authorName}</span>}
                          {prompt.webSearch && <span><Globe size={11} /> Web</span>}
                          {attachmentCount > 0 && <span><Paperclip size={11} /> {attachmentCount}</span>}
                        </div>
                      </div>

                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={editingQueuedContent}
                          onChange={(event) => setEditingQueuedContent(event.target.value)}
                          onKeyDown={(event) => handleQueuedEditKeyDown(event, prompt)}
                          className="queued-prompt-card__editor"
                          rows={3}
                          aria-label={`Edit queued prompt ${index + 1}`}
                        />
                      ) : (
                        <p className="queued-prompt-card__content">
                          {prompt.content || `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
                        </p>
                      )}

                      {canManage && <div className="queued-prompt-card__actions">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={cancelQueuedEdit} className="queued-prompt-action" aria-label={`Discard edits to queued prompt ${index + 1}`}>
                              <X size={12} /> Discard
                            </button>
                            <button
                              type="button"
                              onClick={() => saveQueuedEdit(prompt)}
                              disabled={!editingQueuedContent.trim() && !attachmentCount}
                              className="queued-prompt-action queued-prompt-action--primary"
                              aria-label={`Save queued prompt ${index + 1}`}
                            >
                              <Check size={12} /> Save
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSendQueuedNow?.(prompt.id)}
                              className="queued-prompt-action queued-prompt-action--primary"
                              aria-label={`Steer now with queued prompt ${index + 1}`}
                            >
                              <CornerDownRight size={12} /> Steer
                            </button>
                            <button type="button" onClick={() => beginQueuedEdit(prompt)} className="queued-prompt-action" aria-label={`Edit queued prompt ${index + 1}`}>
                              <Pencil size={12} /> Edit
                            </button>
                            <button type="button" onClick={() => onRemoveQueued?.(prompt.id)} className="queued-prompt-action queued-prompt-action--danger" aria-label={`Cancel queued prompt ${index + 1}`}>
                              <X size={12} /> Cancel
                            </button>
                          </>
                        )}
                      </div>}
                    </article>
                  );
                })}
              </div>
              <p className="queued-prompt-stack__hint">Runs in order · Steer interrupts the current response</p>
            </section>
          )}
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

            {queueMode && (
              <p className="pt-2 text-[10px] tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                {isGenerating
                  ? 'Enter queues · Command/Control + Enter steers now'
                  : `${busyUser?.displayName || busyUser?.email || 'A collaborator'} is responding · Enter queues your prompt`}
              </p>
            )}

            {(voiceActive || voiceStatus === 'connecting' || voiceStatus === 'error') && (
              <div className="voice-mode-status" role="status" aria-live="polite" data-state={voiceStatus}>
                <span className="voice-mode-status__pulse" />
                <span>{voiceStatusLabel}</span>
                {voiceActive && (
                  <button type="button" onClick={onToggleVoice} aria-label="End voice conversation">
                    End
                  </button>
                )}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="hud-attachment-strip pt-3 pb-2">
                {attachments.map((att, i) => {
                  if (att.isImage) {
                    return (
                      <div key={i} className="relative rounded-md overflow-hidden animate-fade-in group" style={{ width: '64px', height: '64px', border: '1px solid var(--hud-cyan-dim)' }}>
                        <img src={att.base64} alt={att.name || 'Attached image'} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          aria-label={`Remove ${att.name || 'attached image'}`}
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
                      <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${att.name}`} className="p-0.5 rounded hover:scale-110 transition-all" style={{ color: 'var(--text-tertiary)' }}>
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
                onPaste={handlePaste}
                aria-label="Message MIRA"
                aria-describedby="attachment-status"
                placeholder="Message MIRA..."
                rows={1}
                className="hud-composer-textarea"
                style={{ padding: '12px 4px' }}
              />

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

              <button
                type="button"
                onClick={onToggleVoice}
                className="composer-icon-btn"
                data-active={voiceActive || undefined}
                title={voiceActive ? 'End voice conversation' : 'Start voice conversation'}
                aria-label={voiceActive ? 'End voice conversation' : 'Start voice conversation'}
                aria-pressed={voiceActive}
              >
                {voiceActive ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              {isGenerating ? (
                <>
                  <button
                    type="button"
                    onClick={onStop}
                    className="composer-icon-btn"
                    style={{ color: '#fda4af' }}
                    title="Stop response"
                    aria-label="Stop response"
                  >
                    <Square size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleSubmit(event, 'queue')}
                    disabled={!input.trim() && attachments.length === 0}
                    className="composer-icon-btn"
                    title="Queue after current response (Enter)"
                    aria-label="Queue prompt"
                  >
                    <ListPlus size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleSubmit(event, 'steer')}
                    disabled={!input.trim() && attachments.length === 0}
                    className="composer-send-btn"
                    title="Steer current response (Command or Control + Enter)"
                    aria-label="Steer current response"
                  >
                    <CornerDownRight size={18} />
                  </button>
                </>
              ) : isConversationBusy ? (
                <button
                  type="button"
                  onClick={(event) => handleSubmit(event, 'queue')}
                  disabled={!input.trim() && attachments.length === 0}
                  className="composer-send-btn"
                  title="Queue after the current response"
                  aria-label="Queue prompt"
                >
                  <ListPlus size={18} />
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
            <p id="attachment-status" role="status" aria-live="polite" className="sr-only">
              {attachmentNotice}
            </p>
          </div>
        </div>
      </div>

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

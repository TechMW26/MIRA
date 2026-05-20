import { useState, useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X, FileText, Image as ImageIcon, FileCode, File, Globe, Loader, PanelRight, Code2, Zap, Wrench, BookMarked, Share2, Volume2 } from 'lucide-react';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';
import { formatVoiceLabel, getVoiceKey, pickPreferredVoice, getPreferredVoiceId, setPreferredVoiceId } from '../../utils/tts';

const ACCEPT_TYPES = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,.heic,.sh,.rs,.go,.rb,.php,.sql';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return ImageIcon;
  if (['js','jsx','ts','tsx','py','java','c','cpp','html','css'].includes(ext)) return FileCode;
  if (['txt','md','csv','log','json','xml','yaml','yml'].includes(ext)) return FileText;
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
  const [voices, setVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState(getPreferredVoiceId());
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;

    const refreshVoices = () => {
      const nextVoices = window.speechSynthesis.getVoices();
      setVoices(nextVoices);
      setSelectedVoiceId((current) => current || getPreferredVoiceId());
    };

    refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoices);
  }, []);

  const preferredVoice = pickPreferredVoice(voices);
  const voiceOptions = voices
    .slice()
    .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));

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
    dragCounterRef.current++;
    setDragging(true);
  }

  function onDragLeave(e) {
    if (!hasFileLikeDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current--;
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

  function handleVoiceChange(event) {
    const nextId = event.target.value;
    setSelectedVoiceId(nextId);
    setPreferredVoiceId(nextId);
  }

  return (
    <div className="flex-shrink-0 px-3 lg:px-0 pb-5 pt-3">
      <div className="max-w-3xl mx-auto">
        <div className="chat-input-wrap relative">
          <div
            className="glass rounded-2xl overflow-hidden relative chat-input-shell"
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
          {dragging && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl pointer-events-none"
              style={{ background: 'var(--accent-glow)', border: '2px dashed var(--accent)', backdropFilter: 'blur(4px)' }}
            >
              <Paperclip size={24} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-medium mt-2" style={{ color: 'var(--accent)' }}>Drop files here</p>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachments.map((att, i) => {
                if (att.isImage) {
                  return (
                    <div key={i} className="relative rounded-xl overflow-hidden animate-fade-in group" style={{ width: '80px', height: '80px' }}>
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
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-subtle text-xs animate-fade-in"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Icon size={14} style={{ color: 'var(--accent)' }} />
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

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message MIRA..."
            rows={1}
            className="w-full resize-none px-5 pt-4 pb-2 text-sm leading-relaxed bg-transparent outline-none placeholder:text-[var(--text-tertiary)]"
            style={{ color: 'var(--text-primary)' }}
          />

          <input ref={fileInputRef} type="file" multiple accept={ACCEPT_TYPES} onChange={handleFiles} className="hidden" />

          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="p-2 rounded-xl transition-all duration-200 hover:scale-105 disabled:opacity-50"
                style={{ color: parsing ? 'var(--accent)' : 'var(--text-tertiary)' }}
                title="Attach files"
              >
                {parsing ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>

              <button
                onClick={onToggleWebSearch}
                className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                style={webSearch ? { color: 'var(--accent)', background: 'var(--hover-bg)' } : { color: 'var(--text-tertiary)' }}
                title={webSearch ? 'Web search ON' : 'Web search OFF'}
              >
                <Globe size={16} />
              </button>

              {voices.length > 0 && (
                <div className="flex items-center gap-1 rounded-xl px-2 py-1" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
                  <Volume2 size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <select
                    value={selectedVoiceId || ''}
                    onChange={handleVoiceChange}
                    className="bg-transparent text-[11px] outline-none max-w-[160px]"
                    style={{ color: 'var(--text-primary)' }}
                    title={preferredVoice ? formatVoiceLabel(preferredVoice) : 'Select voice'}
                  >
                    <option value="">Best available</option>
                    {voiceOptions.map((voice) => {
                      const id = getVoiceKey(voice);
                      return (
                        <option key={id} value={id}>
                          {formatVoiceLabel(voice)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {[
                { id: 'browser', icon: PanelRight, title: 'Browser' },
                { id: 'canvas', icon: Code2, title: 'Canvas' },
                { id: 'tasks', icon: Zap, title: 'Task Runner' },
                { id: 'tools', icon: Wrench, title: 'Tools' },
                { id: 'prompts', icon: BookMarked, title: 'Prompts' },
              ].map(({ id, icon: Icon, title }) => (
                <button key={id} onClick={() => onTogglePanel(id)}
                  className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                  style={activePanel === id ? { color: 'var(--accent)', background: 'var(--hover-bg)' } : { color: 'var(--text-tertiary)' }}
                  title={title}>
                  <Icon size={16} />
                </button>
              ))}
              {messages?.length > 0 && (
                <button onClick={onShare} className="p-2 rounded-xl transition-all duration-200 hover:scale-105" style={{ color: 'var(--text-tertiary)' }} title="Share">
                  <Share2 size={16} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isGenerating ? (
                <button
                  onClick={onStop}
                  className="p-2.5 rounded-xl bg-red-500/20 text-red-400 transition-all duration-200 hover:scale-105 hover:bg-red-500/30"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() && attachments.length === 0}
                  className="p-2.5 rounded-xl transition-all duration-200 hover:opacity-90 disabled:opacity-30 disabled:hover:scale-100"
                  style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
        </div>

        <p className="text-center text-[10px] mt-2.5 leading-tight" style={{ color: 'var(--text-tertiary)' }}>
          MIRA can make mistakes. Consider checking important info.
        </p>
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

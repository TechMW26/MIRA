import { useState, useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X, FileText, Image as ImageIcon, FileCode, File } from 'lucide-react';

const ACCEPT_TYPES = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg';

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

export default function ChatInput({ onSend, onStop, isGenerating }) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

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

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const processed = await Promise.all(
      files.map(async (file) => {
        const isImage = file.type.startsWith('image/');
        const base64 = await readFileAsBase64(file);

        if (isImage) {
          return { name: file.name, size: file.size, type: file.type, isImage: true, base64, mimeType: file.type };
        }

        // For text-based files, read text content for AI processing
        const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript'];
        const textExts = ['txt','md','csv','log','json','xml','yaml','yml','js','jsx','ts','tsx','py','java','c','cpp','html','css','svg'];
        const ext = file.name.split('.').pop().toLowerCase();
        const isText = textTypes.some((t) => file.type.startsWith(t)) || textExts.includes(ext);

        let text = '';
        if (isText) {
          text = await readFileAsText(file);
        }

        return {
          name: file.name,
          size: file.size,
          type: file.type,
          isImage: false,
          text,
          base64,
          mimeType: file.type,
        };
      })
    );

    setAttachments((prev) => [...prev, ...processed]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="px-3 lg:px-0 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
          <div className="glass rounded-2xl overflow-hidden transition-all duration-300 focus-within:ring-1 focus-within:ring-[var(--border)]">
          {/* Attachments preview */}
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

          {/* Textarea */}
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

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_TYPES}
            onChange={handleFiles}
            className="hidden"
          />

          {/* Bottom controls */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              {/* Attach file */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                style={{ color: 'var(--text-tertiary)' }}
                title="Attach files"
              >
                <Paperclip size={16} />
              </button>
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

        <p className="text-center text-[10px] mt-2.5 leading-tight" style={{ color: 'var(--text-tertiary)' }}>
          MIRA can make mistakes. Consider checking important info.
        </p>
      </div>
    </div>
  );
}

function readFileAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(`[Error reading ${file.name}]`);
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

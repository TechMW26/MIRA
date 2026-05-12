import { useState, useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X, FileText, Image as ImageIcon, FileCode, File, Mic, MicOff, Globe, Loader, PanelRight, Code2, Zap, Wrench, BookMarked, Share2 } from 'lucide-react';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';

const ACCEPT_TYPES = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.sh,.rs,.go,.rb,.php,.sql';

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

export default function ChatInput({ onSend, onStop, isGenerating, webSearch, onToggleWebSearch, activePanel, onTogglePanel, onShare, messages }) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop?.();
    };
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
    }
  }, [input]);

  function toggleListening() {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  }

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
    if (!files.length) return;
    setParsing(true);
    const processed = await Promise.all(
      files.map(async (file) => {
        const isImage = file.type.startsWith('image/');
        const base64 = await readFileAsBase64(file);
        if (isImage) return { name: file.name, size: file.size, type: file.type, isImage: true, base64, mimeType: file.type };
        let text = '';
        if (isExtractableFile(file)) text = await extractFileText(file) || '';
        return { name: file.name, size: file.size, type: file.type, isImage: false, text, base64, mimeType: file.type, parsed: !!text };
      })
    );
    setAttachments((prev) => [...prev, ...processed]);
    setParsing(false);
  }

  async function handleFiles(e) {
    await processFiles(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onDragEnter(e) {
    e.preventDefault();
    dragCounterRef.current++;
    setDragging(true);
  }

  function onDragLeave(e) {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  async function onDrop(e) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    await processFiles(files);
  }

  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="px-3 lg:px-0 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div
          className="glass rounded-2xl overflow-hidden transition-all duration-300 focus-within:ring-1 focus-within:ring-[var(--border)] relative"
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

              {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                <button
                  onClick={toggleListening}
                  className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                  style={isListening ? { color: 'var(--accent)', background: 'var(--hover-bg)' } : { color: 'var(--text-tertiary)' }}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}

              <button
                onClick={onToggleWebSearch}
                className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                style={webSearch ? { color: 'var(--accent)', background: 'var(--hover-bg)' } : { color: 'var(--text-tertiary)' }}
                title={webSearch ? 'Web search ON' : 'Web search OFF'}
              >
                <Globe size={16} />
              </button>

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

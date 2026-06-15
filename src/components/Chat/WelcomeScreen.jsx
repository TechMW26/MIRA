import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Code2, Lightbulb, MessageCircle, Eye, Bug, PenLine, Calculator, Database, FlaskConical, FileText,
  BarChart3, Globe, Palette, Shield, Send, X, Paperclip, Camera, RefreshCw,
  Image as ImageIcon, FileCode, File as FileIcon,
  Mail, Folder, Mic, AudioLines, Wrench, MessageSquare,
} from 'lucide-react';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';
import ParticleGlobe from './ParticleGlobe';
import { useChatContext } from '../../contexts/ChatContext';

const ATTACH_ACCEPT = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,.heic';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);

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

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function attachmentIcon(name) {
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return ImageIcon;
  if (['js','jsx','ts','tsx','py','java','c','cpp','html','css'].includes(ext)) return FileCode;
  if (['txt','md','csv','log','json','xml','yaml','yml'].includes(ext)) return FileText;
  return FileIcon;
}

function CameraCaptureModal({ onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState('user');
  const [error, setError] = useState('');

  const startStream = useCallback(async (facingMode) => {
    setError('');
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setError(err?.message || 'Could not access the camera.');
    }
  }, []);

  useEffect(() => {
    startStream(facing);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [facing, startStream]);

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    onCapture({
      name: `camera-${Date.now()}.jpg`,
      size: Math.round((dataUrl.length * 3) / 4),
      type: 'image/jpeg',
      mimeType: 'image/jpeg',
      isImage: true,
      base64: dataUrl,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="glass-strong rounded-3xl p-5 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Camera size={18} style={{ color: 'var(--accent)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Camera</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              className="p-1.5 rounded-lg transition-all hover:scale-110"
              style={{ color: 'var(--text-tertiary)' }}
              title="Switch camera"
            >
              <RefreshCw size={16} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg transition-all hover:scale-110" style={{ color: 'var(--text-tertiary)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden relative" style={{ background: '#000', aspectRatio: '4 / 3' }}>
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs px-4 text-center" style={{ color: '#fff', background: 'rgba(0,0,0,0.6)' }}>
              {error}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSnap}
          disabled={!!error}
          className="w-full mt-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
        >
          <Camera size={15} />
          Capture
        </button>
      </div>
    </div>
  );
}

const TEMPLATE_POOL = [
  {
    icon: Code2,
    label: 'Write a React component',
    color: 'bg-blue-500',
    inputs: [
      { key: 'name', label: 'Component name', placeholder: 'e.g., UserCard, Dashboard' },
      { key: 'desc', label: 'What should it do?', placeholder: 'Describe the component behavior...', multiline: true },
    ],
    buildPrompt: (v) => `Write a React component called "${v.name}". ${v.desc}`,
  },
  {
    icon: Lightbulb,
    label: 'Explain a concept',
    color: 'bg-amber-500',
    inputs: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g., quantum computing, blockchain' },
      { key: 'level', label: 'Explanation level', placeholder: 'e.g., beginner, expert' },
    ],
    buildPrompt: (v) => `Explain ${v.topic} at a ${v.level || 'beginner'} level in a clear and structured way.`,
  },
  {
    icon: MessageCircle,
    label: 'Write a professional email',
    color: 'bg-emerald-500',
    inputs: [
      { key: 'purpose', label: 'Purpose', placeholder: 'e.g., follow-up, job application, meeting request' },
      { key: 'details', label: 'Key points to include', placeholder: 'What should the email convey?', multiline: true },
    ],
    buildPrompt: (v) => `Write a professional email for: ${v.purpose}. Key points: ${v.details}`,
  },
  {
    icon: Eye,
    label: 'Analyze an image',
    color: 'bg-pink-500',
    inputs: [
      { key: 'desc', label: 'What should be analyzed?', placeholder: 'Describe the image or attach one after submitting...', multiline: true },
      { key: 'focus', label: 'Focus area (optional)', placeholder: 'e.g., objects, text, design, safety' },
    ],
    buildPrompt: (v) => `Analyze this image${v.focus ? ` focusing on ${v.focus}` : ''}: ${v.desc}`,
  },
  {
    icon: Bug,
    label: 'Debug my code',
    color: 'bg-red-500',
    inputs: [
      { key: 'language', label: 'Language / Framework', placeholder: 'e.g., JavaScript, Python, React' },
      { key: 'issue', label: 'Describe the issue', placeholder: 'What error or unexpected behavior are you seeing?', multiline: true },
    ],
    buildPrompt: (v) => `Debug this ${v.language} issue: ${v.issue}`,
  },
  {
    icon: PenLine,
    label: 'Write a blog post',
    color: 'bg-violet-500',
    inputs: [
      { key: 'topic', label: 'Topic', placeholder: 'What should the blog post be about?' },
      { key: 'tone', label: 'Tone', placeholder: 'e.g., casual, formal, humorous' },
    ],
    buildPrompt: (v) => `Write a blog post about ${v.topic} in a ${v.tone || 'professional'} tone.`,
  },
  {
    icon: Calculator,
    label: 'Solve a math problem',
    color: 'bg-sky-500',
    inputs: [
      { key: 'problem', label: 'Problem', placeholder: 'Enter the math problem or equation...', multiline: true },
    ],
    buildPrompt: (v) => `Solve this math problem step by step: ${v.problem}`,
  },
  {
    icon: Database,
    label: 'Design a database schema',
    color: 'bg-indigo-500',
    inputs: [
      { key: 'project', label: 'Project description', placeholder: 'e.g., e-commerce platform, social media app' },
      { key: 'entities', label: 'Main entities', placeholder: 'e.g., users, products, orders' },
    ],
    buildPrompt: (v) => `Design a database schema for a ${v.project} with these entities: ${v.entities}`,
  },
  {
    icon: FlaskConical,
    label: 'Write unit tests',
    color: 'bg-lime-500',
    inputs: [
      { key: 'code', label: 'Function or code to test', placeholder: 'Paste or describe the code...', multiline: true },
      { key: 'framework', label: 'Testing framework', placeholder: 'e.g., Jest, Pytest, JUnit' },
    ],
    buildPrompt: (v) => `Write unit tests using ${v.framework || 'Jest'} for this code:\n${v.code}`,
  },
  {
    icon: FileText,
    label: 'Summarize content',
    color: 'bg-teal-500',
    inputs: [
      { key: 'content', label: 'Content to summarize', placeholder: 'Paste text or describe the topic...', multiline: true },
      { key: 'length', label: 'Summary length', placeholder: 'e.g., 1 paragraph, 5 bullet points' },
    ],
    buildPrompt: (v) => `Summarize the following in ${v.length || 'a concise paragraph'}:\n${v.content}`,
  },
  {
    icon: BarChart3,
    label: 'Analyze data',
    color: 'bg-cyan-500',
    inputs: [
      { key: 'data', label: 'Data or context', placeholder: 'Describe or paste the data...', multiline: true },
      { key: 'goal', label: 'Analysis goal', placeholder: 'What insights are you looking for?' },
    ],
    buildPrompt: (v) => `Analyze this data. Goal: ${v.goal}\n\nData:\n${v.data}`,
  },
  {
    icon: Globe,
    label: 'Write an API endpoint',
    color: 'bg-green-500',
    inputs: [
      { key: 'framework', label: 'Framework', placeholder: 'e.g., Express, FastAPI, Django' },
      { key: 'desc', label: 'What should the endpoint do?', placeholder: 'Describe the endpoint behavior...', multiline: true },
    ],
    buildPrompt: (v) => `Write a ${v.framework} API endpoint that ${v.desc}`,
  },
  {
    icon: Palette,
    label: 'Design a color palette',
    color: 'bg-fuchsia-500',
    inputs: [
      { key: 'theme', label: 'Theme or mood', placeholder: 'e.g., modern SaaS, nature-inspired, dark mode' },
      { key: 'count', label: 'Number of colors', placeholder: 'e.g., 5, 8' },
    ],
    buildPrompt: (v) => `Create a ${v.count || '6'}-color palette for a ${v.theme} design. Provide hex codes, names, and usage suggestions.`,
  },
  {
    icon: Shield,
    label: 'Security code review',
    color: 'bg-rose-500',
    inputs: [
      { key: 'code', label: 'Code to review', placeholder: 'Paste the code...', multiline: true },
      { key: 'focus', label: 'Focus areas (optional)', placeholder: 'e.g., auth, injection, XSS' },
    ],
    buildPrompt: (v) => `Review this code for security vulnerabilities${v.focus ? ` focusing on ${v.focus}` : ''}:\n${v.code}`,
  },
];

function TemplateForm({ template, onSubmit, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(template.inputs.map((inp) => [inp.key, '']))
  );
  const [attachments, setAttachments] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef(null);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setParsing(true);
    try {
      const next = await Promise.all(files.map(async (file) => {
        const mimeType = file.type || mimeFromName(file.name);
        const base64 = await readFileAsBase64(file);
        const isImage = isImageFile(file);
        if (isImage) {
          return { name: file.name, size: file.size, type: mimeType, mimeType, isImage: true, base64 };
        }
        let text = '';
        let parseError = '';
        if (isExtractableFile(file)) {
          try {
            text = (await extractFileText(file)) || '';
          } catch (error) {
            parseError = error?.message || 'Could not read this file.';
          }
        }
        return {
          name: file.name,
          size: file.size,
          type: mimeType,
          mimeType,
          isImage: false,
          base64,
          text,
          parsed: !!text,
          parseError,
        };
      }));
      setAttachments((prev) => [...prev, ...next]);
    } finally {
      setParsing(false);
    }
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const hasContent = Object.values(values).some((v) => v.trim());
    if (!hasContent && attachments.length === 0) return;
    onSubmit(template.buildPrompt(values), attachments);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="glass-strong rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${template.color} flex items-center justify-center`}>
              <template.icon size={16} className="text-white" />
            </div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {template.label}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-all hover:scale-110" style={{ color: 'var(--text-tertiary)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {template.inputs.map((inp) => (
            <div key={inp.key}>
              <label className="block text-xs font-medium mb-1.5 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>
                {inp.label}
              </label>
              {inp.multiline ? (
                <textarea
                  value={values[inp.key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [inp.key]: e.target.value }))}
                  placeholder={inp.placeholder}
                  rows={3}
                  className="w-full glass-input rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)] resize-none"
                  style={{ color: 'var(--text-primary)' }}
                />
              ) : (
                <input
                  type="text"
                  value={values[inp.key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [inp.key]: e.target.value }))}
                  placeholder={inp.placeholder}
                  className="w-full glass-input rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)]"
                  style={{ color: 'var(--text-primary)' }}
                />
              )}
            </div>
          ))}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, i) => {
                if (att.isImage) {
                  return (
                    <div key={i} className="relative rounded-xl overflow-hidden group" style={{ width: '72px', height: '72px' }}>
                      <img src={att.base64} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeAttachment(i)} className="absolute top-1 right-1 p-0.5 rounded-full transition-all opacity-0 group-hover:opacity-100" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                }
                const Icon = attachmentIcon(att.name);
                return (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-subtle text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <Icon size={14} style={{ color: 'var(--accent)' }} />
                    <span className="max-w-[120px] truncate">{att.name}</span>
                    <button type="button" onClick={() => removeAttachment(i)} className="p-0.5 rounded hover:scale-110 transition-all" style={{ color: 'var(--text-tertiary)' }}>
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Attach controls */}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" multiple accept={ATTACH_ACCEPT} className="hidden" onChange={(e) => { handleFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <Paperclip size={14} />
              Attach
            </button>
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <Camera size={14} />
              Camera
            </button>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl font-medium text-sm transition-all duration-200 hover:opacity-90 flex items-center justify-center gap-2"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            <Send size={15} />
            Generate
          </button>
        </form>

        {showCamera && (
          <CameraCaptureModal
            onClose={() => setShowCamera(false)}
            onCapture={(att) => { setAttachments((prev) => [...prev, att]); setShowCamera(false); }}
          />
        )}
      </div>
    </div>
  );
}

export default function WelcomeScreen({ onSend }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [iconAttractor, setIconAttractor] = useState(null);
  const { selectedModel } = useChatContext();

  // Fixed orbit lineup matching the reference HUD mockup. Each entry pairs
  // the visual icon shown on the ring with the prompt template it opens.
  const orbitTools = useMemo(() => {
    const byLabel = (label) => TEMPLATE_POOL.find((t) => t.label === label);
    const lineup = [
      { icon: Lightbulb,      template: byLabel('Explain a concept') },
      { icon: Code2,          template: byLabel('Write a React component') },
      { icon: Database,       template: byLabel('Design a database schema') },
      { icon: Mail,           template: byLabel('Write a professional email') },
      { icon: Wrench,         template: byLabel('Debug my code') },
      { icon: AudioLines,     template: byLabel('Solve a math problem') },
      { icon: Folder,         template: byLabel('Summarize content') },
      { icon: Globe,          template: byLabel('Write an API endpoint') },
      { icon: MessageSquare,  template: byLabel('Write a blog post') },
      { icon: Shield,         template: byLabel('Security code review') },
    ];
    return lineup
      .filter((item) => item.template)
      .map((item) => ({ ...item.template, icon: item.icon }));
  }, []);

  const handleTemplateSubmit = (prompt, attachments = []) => {
    setSelectedTemplate(null);
    onSend(prompt, attachments);
  };

  return (
    <>
      {/* Full-viewport particle field so the globe + its outer particles span
          the whole screen and never clip against a tight canvas edge. */}
      <ParticleGlobe iconAttractor={iconAttractor} locked={selectedModel === 'locked'} />

      {/* Template form modal */}
      {selectedTemplate && (
        <TemplateForm
          template={selectedTemplate}
          onSubmit={handleTemplateSubmit}
          onClose={() => setSelectedTemplate(null)}
        />
      )}

      <ToolOrbit
        tools={orbitTools}
        onSelect={setSelectedTemplate}
        onHoverChange={setIconAttractor}
      />
    </>
  );
}

/**
 * ToolOrbit — tool icons placed on a ring around the viewport-centered globe.
 * Rendered as a fixed full-viewport layer so the icons line up with the
 * full-screen particle canvas and always have room (never get clipped).
 */
function ToolOrbit({ tools, onSelect, onHoverChange }) {
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const centerX = vp.w / 2;
  const centerY = vp.h / 2;
  const vmin = Math.min(vp.w, vp.h);
  // Orbit sits ~1.6x the sphere radius so the icons hug the globe closely
  // while still clearing its corona glow.
  // Keep the ring outside the sphere but capped so the top/bottom icons stay
  // clear of the floating header and composer bars.
  const orbitRadius = Math.max(120, Math.min(vmin * 0.26, vp.h / 2 - 130));
  const ringD = orbitRadius * 2;

  return (
    <div className="welcome-orbit-layer">
      <div
        className="tool-orbit-ring outer"
        style={{ left: centerX, top: centerY, width: ringD * 1.08, height: ringD * 1.08 }}
      />
      <div
        className="tool-orbit-ring"
        style={{ left: centerX, top: centerY, width: ringD, height: ringD }}
      />

      {tools.map((tool, idx) => {
        const angle = (-Math.PI / 2) + ((Math.PI * 2) / tools.length) * idx;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const x = centerX + dx * orbitRadius;
        const y = centerY + dy * orbitRadius;
        // Place the label on the "empty" outward side of each icon.
        const placement =
          Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
        const Icon = tool.icon;
        return (
          <button
            key={tool.label}
            type="button"
            onClick={() => onSelect(tool)}
            onMouseEnter={() => onHoverChange?.({ x, y, label: tool.label })}
            onMouseLeave={() => onHoverChange?.(null)}
            onFocus={() => onHoverChange?.({ x, y, label: tool.label })}
            onBlur={() => onHoverChange?.(null)}
            className="tool-node"
            style={{ left: `${x}px`, top: `${y}px` }}
            title={tool.label}
          >
            <Icon size={22} strokeWidth={1.5} />
            <span className={`tool-node-tip ${placement}`}>{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
}

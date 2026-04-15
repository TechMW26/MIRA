import { useState, useMemo } from 'react';
import { Sparkles, Code2, Lightbulb, MessageCircle, Image, Bug, PenLine, Calculator, Database, FlaskConical, FileText, BarChart3, Globe, Palette, Shield, Send, X } from 'lucide-react';

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
    icon: Image,
    label: 'Generate an image',
    color: 'bg-pink-500',
    inputs: [
      { key: 'desc', label: 'Image description', placeholder: 'Describe what you want to see...', multiline: true },
      { key: 'style', label: 'Style (optional)', placeholder: 'e.g., watercolor, photorealistic, minimalist' },
    ],
    buildPrompt: (v) => `Generate an image of ${v.desc}${v.style ? ` in a ${v.style} style` : ''}`,
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function TemplateForm({ template, onSubmit, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(template.inputs.map((inp) => [inp.key, '']))
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    const hasContent = Object.values(values).some((v) => v.trim());
    if (!hasContent) return;
    onSubmit(template.buildPrompt(values));
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

          <button
            type="submit"
            className="w-full py-3 rounded-xl font-medium text-sm transition-all duration-200 hover:opacity-90 flex items-center justify-center gap-2"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            <Send size={15} />
            Generate
          </button>
        </form>
      </div>
    </div>
  );
}

export default function WelcomeScreen({ onSend }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const visibleTemplates = useMemo(() => shuffle(TEMPLATE_POOL).slice(0, 6), []);

  const handleTemplateSubmit = (prompt) => {
    setSelectedTemplate(null);
    onSend(prompt);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-10 animate-fade-in">
      {/* Template form modal */}
      {selectedTemplate && (
        <TemplateForm
          template={selectedTemplate}
          onSubmit={handleTemplateSubmit}
          onClose={() => setSelectedTemplate(null)}
        />
      )}

      {/* Section label */}
      <p className="text-xs font-medium tracking-widest uppercase mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Quick start
      </p>

      {/* Suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-2xl">
        {visibleTemplates.map((t, i) => (
          <button
            key={i}
            onClick={() => setSelectedTemplate(t)}
            className="group glass-subtle rounded-2xl p-4 text-left transition-all duration-300 hover:shadow-sm"
            style={{ animationDelay: `${i * 0.06}s` }}
          >
            <div className={`w-9 h-9 rounded-xl ${t.color} flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110`}>
              <t.icon size={16} className="text-white" />
            </div>
            <span className="text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Footer */}
    </div>
  );
}

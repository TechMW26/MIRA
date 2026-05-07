import { useState, useEffect } from 'react';
import { X, Plus, Search, BookMarked, Trash2, Send, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ref, push, set, get, remove, onValue, off } from 'firebase/database';
import { db } from '../../config/firebase';

const FEATURED = [
  { title: 'Expert Code Reviewer', prompt: 'Review this code for bugs, performance issues, security vulnerabilities, and best practices. Be specific and actionable:', category: 'Dev' },
  { title: 'Socratic Teacher', prompt: 'Teach me about [topic] using the Socratic method. Ask me questions to guide my understanding rather than just explaining:', category: 'Learning' },
  { title: 'Devil\'s Advocate', prompt: 'Play devil\'s advocate for this idea and give me the strongest possible counterarguments:', category: 'Thinking' },
  { title: 'ELI5', prompt: 'Explain this like I\'m 5 years old, using simple analogies and no jargon:', category: 'Learning' },
  { title: 'First Principles', prompt: 'Break this down to first principles. What are the fundamental truths we can build from?', category: 'Thinking' },
  { title: 'PRD Writer', prompt: 'Write a detailed Product Requirements Document (PRD) for:', category: 'Product' },
  { title: 'Cold Email', prompt: 'Write a compelling cold email for [purpose]. Make it personal, concise, and end with a clear CTA:', category: 'Writing' },
  { title: 'SQL Query Builder', prompt: 'Write an optimized SQL query to:', category: 'Dev' },
];

export default function PromptLibrary({ onUsePrompt, onClose }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('featured'); // 'featured' | 'saved'
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!user) return;
    const r = ref(db, `prompts/${user.uid}`);
    onValue(r, snap => {
      const items = [];
      snap.forEach(child => items.push({ id: child.key, ...child.val() }));
      setSaved(items.reverse());
    });
    return () => off(r);
  }, [user]);

  async function savePrompt() {
    if (!user || !newTitle.trim() || !newPrompt.trim()) return;
    const r = push(ref(db, `prompts/${user.uid}`));
    await set(r, { title: newTitle.trim(), prompt: newPrompt.trim(), createdAt: Date.now() });
    setNewTitle(''); setNewPrompt(''); setAdding(false);
  }

  async function deletePrompt(id) {
    if (!user) return;
    await remove(ref(db, `prompts/${user.uid}/${id}`));
  }

  const filtered = (tab === 'featured' ? FEATURED : saved).filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) || p.prompt.toLowerCase().includes(search.toLowerCase())
  );

  return (
<<<<<<< Updated upstream
    <div className="flex flex-col h-full w-full">
=======
<<<<<<< HEAD
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)' }}>
=======
    <div className="flex flex-col h-full w-full">
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <BookMarked size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Prompt Library</span>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
      </div>

      <div className="flex gap-1 p-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setTab('featured')} className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all"
          style={{ background: tab === 'featured' ? 'var(--accent)' : 'var(--hover-bg)', color: tab === 'featured' ? '#fff' : 'var(--text-secondary)' }}>
          <Star size={10} className="inline mr-1" />Featured
        </button>
        <button onClick={() => setTab('saved')} className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all"
          style={{ background: tab === 'saved' ? 'var(--accent)' : 'var(--hover-bg)', color: tab === 'saved' ? '#fff' : 'var(--text-secondary)' }}>
          Saved ({saved.length})
        </button>
      </div>

      <div className="px-2 py-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
          <Search size={11} style={{ color: 'var(--text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prompts..."
            className="flex-1 text-xs bg-transparent outline-none" style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        {filtered.map((p, i) => (
          <div key={p.id || i} className="rounded-xl p-3 group" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{p.title}</span>
              {p.category && <span className="text-[9px] px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>{p.category}</span>}
            </div>
            <p className="text-[11px] mb-2 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{p.prompt}</p>
            <div className="flex gap-1">
              <button onClick={() => onUsePrompt(p.prompt)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                <Send size={9} /> Use
              </button>
              {tab === 'saved' && (
                <button onClick={() => deletePrompt(p.id)} className="p-1 rounded-lg hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                  <Trash2 size={11} />
                </button>
              )}
              {tab === 'featured' && (
                <button onClick={() => { setNewTitle(p.title); setNewPrompt(p.prompt); setAdding(true); setTab('saved'); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all hover:opacity-80"
                  style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>
                  <Plus size={9} /> Save
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {tab === 'saved' && (
        <div className="p-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {adding ? (
            <div className="space-y-2">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Prompt title"
                className="w-full text-xs px-3 py-2 rounded-xl outline-none"
                style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              <textarea value={newPrompt} onChange={e => setNewPrompt(e.target.value)} placeholder="Prompt text..." rows={3}
                className="w-full text-xs px-3 py-2 rounded-xl outline-none resize-none"
                style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              <div className="flex gap-2">
                <button onClick={() => setAdding(false)} className="flex-1 py-1.5 rounded-xl text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>Cancel</button>
                <button onClick={savePrompt} className="flex-1 py-1.5 rounded-xl text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>Save</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-80"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Plus size={12} /> New Prompt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

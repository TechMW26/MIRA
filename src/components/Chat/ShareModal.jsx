import { useState } from 'react';
import { Share2, Copy, Check, Globe, Lock, X } from 'lucide-react';
import { ref, set, get } from 'firebase/database';
import { db } from '../../config/firebase';

export function useSpaces() {
  async function publishSpace(conversationId, messages, title) {
    const spaceId = Math.random().toString(36).slice(2, 10);
    await set(ref(db, `spaces/${spaceId}`), {
      conversationId,
      title: title || 'MIRA Conversation',
      messages: messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      createdAt: Date.now(),
      views: 0,
    });
    return spaceId;
  }

  async function getSpace(spaceId) {
    const snap = await get(ref(db, `spaces/${spaceId}`));
    return snap.exists() ? snap.val() : null;
  }

  return { publishSpace, getSpace };
}

export default function ShareModal({ messages, title, onClose }) {
  const { publishSpace } = useSpaces();
  const [spaceId, setSpaceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = spaceId ? `${window.location.origin}/space/${spaceId}` : '';

  async function handlePublish() {
    setLoading(true);
    try {
      const id = await publishSpace(null, messages, title);
      setSpaceId(id);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="glass-strong rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Share2 size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Share Conversation</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={14} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>

        {!spaceId ? (
          <>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Publish this conversation as a public page anyone can view and continue.
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl mb-4" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
              <Globe size={14} style={{ color: 'var(--accent)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Anyone with the link can view</span>
            </div>
            <button onClick={handlePublish} disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {loading ? 'Publishing...' : 'Publish Space'}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>Your space is live! Share this link:</p>
            <div className="flex items-center gap-2 p-3 rounded-xl mb-4" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--accent)' }}>{shareUrl}</span>
              <button onClick={handleCopy} className="p-1 rounded hover:opacity-70 flex-shrink-0">
                {copied ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} style={{ color: 'var(--text-tertiary)' }} />}
              </button>
            </div>
            <button onClick={() => window.open(shareUrl, '_blank')}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
              Open Space
            </button>
          </>
        )}
      </div>
    </div>
  );
}

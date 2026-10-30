import { useEffect, useRef, useState } from 'react';
import { talioRequest } from '../../services/talioLink.js';
import { clearWorkplaceMemory } from '../../services/workplacePrivacy.js';

export default function TalioConnection({ userId }) {
  const [link, setLink] = useState(null), [pending, setPending] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [allowActions, setAllowActions] = useState(false);
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; setLink(null); setPending(null); setError(''); setBusy(false); setChecking(true); setAllowActions(false);
    talioRequest('status').then(data => { if (generation.current === current) setLink(data); }).catch(error => { if (generation.current === current) setError(error.message); }).finally(() => { if (generation.current === current) setChecking(false); });
    return () => { generation.current++; };
  }, [userId]);
  useEffect(() => {
    if (!pending) return;
    let active = true, timer;
    const current = generation.current;
    async function poll() {
      if (!active || generation.current !== current) return;
      if (Date.now() >= pending.expiresAt) { setPending(null); setError('The code expired. Start a new connection.'); return; }
      try {
        const data = await talioRequest('poll');
        if (!active || generation.current !== current) return;
        clearWorkplaceMemory(); window.dispatchEvent(new Event('mira:talio-link-changed'));
        setLink({ ...data, account: data.account && { name: data.account.name, company: data.account.company } }); setPending(null); setError('');
      } catch (error) {
        if (!active || generation.current !== current) return;
        if (['authorization_pending', 'slow_down'].includes(error.code)) timer = setTimeout(poll, Math.max(5, error.interval || pending.interval) * 1000);
        else { setPending(null); setError(error.message); }
      }
    }
    timer = setTimeout(poll, pending.interval * 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [pending]);
  async function begin() {
    const current = generation.current; setBusy(true); setError('');
    try {
      const data = await talioRequest('begin', { allowActions });
      if (current !== generation.current) return;
      const url = new URL(data.url);
      if (url.origin !== 'https://app.talio.in' || url.pathname !== '/dashboard/mira/connect') throw new Error('Unexpected Talio approval URL.');
      setPending(data);
      window.open(url.href, '_blank', 'noopener,noreferrer');
    } catch (error) { if (current === generation.current) setError(error.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function disconnect() {
    const current = generation.current; setBusy(true); setError('');
    try { await talioRequest('disconnect'); if (current === generation.current) { clearWorkplaceMemory(); window.dispatchEvent(new Event('mira:talio-link-changed')); setLink({ linked: false }); setPending(null); } }
    catch (error) { if (current === generation.current) setError(error.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <section className="glass-subtle rounded-2xl p-5 space-y-3">
    <h3 className="text-sm font-semibold">Talio workplace</h3>
    {checking && <p role="status" className="text-xs">Checking connection…</p>}
    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Explicitly link a Talio account. Accounts remain separate; no matching-email imports. You can revoke access in either product.</p>
    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>This browser/app connection lasts up to 30 days. Workplace replies synchronize encrypted and are viewable only through this connection. Disconnecting or re-linking makes its earlier encrypted replies unavailable.</p>
    {link?.linked ? <><p className="text-sm">{link.account?.name} · {link.account?.company || 'Talio'}<br /><span className="text-xs">{link.scopes?.includes('workplace:act') ? 'Read and individually confirmed actions' : 'Read only'}</span></p><button type="button" disabled={busy} onClick={disconnect} className="px-3 py-2 rounded-xl border text-sm disabled:opacity-50">Disconnect Talio</button></> : <>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={allowActions} onChange={event => setAllowActions(event.target.checked)} disabled={busy || checking || Boolean(pending)} />Also allow supported workplace actions, with confirmation each time</label>
      <button type="button" disabled={busy || checking || Boolean(pending)} onClick={begin} className="px-3 py-2 rounded-xl border text-sm disabled:opacity-50">{busy ? 'Connecting…' : pending ? 'Waiting for Talio approval…' : 'Connect Talio'}</button>
    </>}
    {pending && <div role="status" className="space-y-2 text-sm"><p>Approve code <strong className="font-mono">{pending.userCode}</strong> in Talio. Never approve a code someone else sent you.</p><a href={pending.url} target="_blank" rel="noopener noreferrer" className="underline">Open Talio approval</a><p className="text-xs">The code expires in five minutes. Return here after approval. If your company requires Talio Desktop, open its Settings → MIRA → Standalone MIRA connections and enter this code.</p></div>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <a href="https://app.talio.in/dashboard/mira/connect" target="_blank" rel="noopener noreferrer" className="block text-xs underline">Manage connections in Talio</a>
  </section>;
}

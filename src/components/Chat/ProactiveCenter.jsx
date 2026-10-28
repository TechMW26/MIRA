import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { claimDueProactiveEvents, createReminder, EVENT_TYPES, readProactiveStore, subscribeProactiveStore, updateProactiveEvent, updateProactiveSettings } from '../../services/proactiveEvents.js';
import { sendDesktopNotification } from '../../services/desktopBridge.js';

export default function ProactiveCenter() {
  const { user } = useAuth();
  const [store, setStore] = useState(null), [open, setOpen] = useState(false), [alerts, setAlerts] = useState([]);
  const [storeOwner, setStoreOwner] = useState('');
  const [title, setTitle] = useState(''), [date, setDate] = useState(''), [error, setError] = useState('');
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) { setStore(null); setAlerts([]); return undefined; }
    let active = true;
    setAlerts([]); setOpen(false);
    const unsubscribe = subscribeProactiveStore(uid, next => { setStore(next); setStoreOwner(uid); });
    const deliver = async () => {
      if (!active) return;
      const claim = () => active ? claimDueProactiveEvents(uid) : [];
      const events = navigator.locks?.request ? await navigator.locks.request(`mira-activity:${uid}`, claim) : claim();
      if (!active || !events.length) return;
      setAlerts(previous => [...previous, ...events].slice(-3));
      for (const event of events) {
        const shown = await sendDesktopNotification({ title: event.type === 'reminder' ? 'Mira reminder' : 'Mira activity', body: event.title, silent: event.priority !== 'high' });
        if (!shown?.shown && !window.miraDesktop && globalThis.Notification?.permission === 'granted') {
          try { new Notification('Mira reminder', { body: event.title, tag: event.id }); } catch {}
        }
      }
    };
    const tick = () => deliver().catch(() => { if (active) setError('Reminder delivery could not be checked. Open Activity and retry.'); });
    tick(); const timer = setInterval(tick, 10_000);
    const wake = () => { if (document.visibilityState !== 'hidden') tick(); };
    window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { active = false; clearInterval(timer); unsubscribe(); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [uid]);
  if (!uid || !store || storeOwner !== uid) return null;
  const events = store.events.filter(e => !['dismissed', 'completed'].includes(e.readState) && (!e.expiresAt || e.expiresAt > Date.now())).sort((a, b) => a.dueAt - b.dueAt);
  const change = action => { try { action(); setError(''); } catch (e) { setError(e.message); } };
  const update = (event, action) => change(() => {
    updateProactiveEvent(uid, event.id, action, { until: Date.now() + 600_000 }); setAlerts(previous => previous.filter(e => e.id !== event.id));
  });
  return <>
    <button type="button" className="mira-activity-trigger" style={{ right: window.miraDesktop ? 160 : 16 }} aria-label="Open Mira activity and reminders" aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={16} /><span>Activity{events.length ? ` · ${events.length}` : ''}</span></button>
    {open && <section className="mira-activity-panel" role="dialog" aria-modal="false" aria-label="Mira activity and reminders">
      <header><h2>Activity & reminders</h2><button type="button" aria-label="Close activity" onClick={() => setOpen(false)}><X size={18} /></button></header>
      <p className="mira-activity-note">Reminders live on this device. Keep Mira running for timely alerts; overdue reminders appear when you return.</p>
      <form onSubmit={event => { event.preventDefault(); change(() => { createReminder(uid, { title, dueAt: new Date(date).getTime() }); setTitle(''); setDate(''); setStore(readProactiveStore(uid)); }); }}>
        <label>Remind me about<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Prepare for the meeting" /></label>
        <label>When<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button className="mira-activity-primary" type="submit">Add reminder</button>
      </form>
      <details><summary>Proactive preferences</summary>
        <label className="mira-activity-check"><input type="checkbox" checked={store.settings.enabled} onChange={event => change(() => updateProactiveSettings(uid, { enabled: event.target.checked }))} />Allow proactive activity alerts</label>
        <label className="mira-activity-check"><input type="checkbox" checked={store.settings.quietHours.enabled} onChange={event => change(() => updateProactiveSettings(uid, { quietHours: { enabled: event.target.checked } }))} />Quiet hours (explicit reminders still alert)</label>
        <div className="mira-activity-times">{['start', 'end'].map(name => <label key={name}>{name === 'start' ? 'From' : 'Until'}<input type="time" value={store.settings.quietHours[name]} onChange={event => change(() => updateProactiveSettings(uid, { quietHours: { [name]: event.target.value } }))} /></label>)}</div>
        {EVENT_TYPES.filter(type => type !== 'reminder').map(type => <label className="mira-activity-check" key={type}><input type="checkbox" checked={store.settings.categories[type] !== false} onChange={event => change(() => updateProactiveSettings(uid, { categories: { [type]: event.target.checked } }))} />{type.replaceAll('_', ' ')}</label>)}
      </details>
      <p className="mira-activity-note">This panel shows device-local activity, not external monitoring. Link Talio explicitly in Settings → Account for workplace tools. Other email, calendar, WhatsApp and call accounts are not connected here.</p>
      {error && <p role="alert" className="mira-activity-error">{error}</p>}
      <div className="mira-activity-items">{!events.length ? <p className="mira-activity-note">No active reminders or activity yet.</p> : events.map(event => <article key={event.id}>
        <strong>{event.title}</strong><time dateTime={new Date(event.dueAt).toISOString()}>{new Date(Math.max(event.dueAt, event.snoozedUntil)).toLocaleString()}</time>
        {event.summary && <p>{event.summary}</p>}<div><button type="button" onClick={() => update(event, 'snooze')}>Snooze 10m</button><button type="button" onClick={() => update(event, 'complete')}>Done</button><button type="button" onClick={() => update(event, 'dismiss')}>Dismiss</button></div>
      </article>)}</div>
    </section>}
    {!open && alerts.length > 0 && <aside className="mira-activity-alert" role="alert"><button className="mira-activity-alert-close" type="button" aria-label="Hide reminder alert" onClick={() => setAlerts([])}><X size={16} /></button>{alerts.map(event => <div key={event.id}><strong>{event.title}</strong><div><button type="button" onClick={() => update(event, 'snooze')}>Snooze 10m</button><button type="button" onClick={() => update(event, 'dismiss')}>Dismiss</button><button type="button" onClick={() => setOpen(true)}>Details</button></div></div>)}</aside>}
  </>;
}

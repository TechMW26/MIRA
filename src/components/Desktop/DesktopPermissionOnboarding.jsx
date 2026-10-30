import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { getDesktopPermissionStatus, isDesktopPermissionGranted, requestDesktopPermission } from '../../services/desktopBridge.js';
import { desktopPermissionStorageKeys, getDesktopPermissionSequence } from '../../services/desktopPermissions.js';

const keys = desktopPermissionStorageKeys();

export default function DesktopPermissionOnboarding() {
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [awaitingSettings, setAwaitingSettings] = useState(false);
  const [message, setMessage] = useState('');
  const unresolvedRef = useRef(new Set());
  const automaticAttemptRef = useRef(new Set());
  const sequence = useMemo(() => getDesktopPermissionSequence(platform), [platform]);
  const current = sequence[index] || null;

  const finish = useCallback(() => {
    if (unresolvedRef.current.size) {
      localStorage.setItem(keys.retry, JSON.stringify([...unresolvedRef.current]));
      localStorage.removeItem(keys.completed);
    } else {
      localStorage.setItem(keys.completed, 'yes');
      localStorage.removeItem(keys.retry);
    }
    setVisible(false);
  }, []);

  const advance = useCallback((permission, { unresolved = false } = {}) => {
    if (unresolved) unresolvedRef.current.add(permission);
    else unresolvedRef.current.delete(permission);
    setAwaitingSettings(false);
    setMessage('');
    setIndex((currentIndex) => {
      if (currentIndex + 1 >= sequence.length) {
        queueMicrotask(finish);
        return currentIndex;
      }
      return currentIndex + 1;
    });
  }, [finish, sequence.length]);

  const requestCurrent = useCallback(async (permission, { automatic = false } = {}) => {
    if (!permission || busy) return;
    setBusy(true);
    setAwaitingSettings(false);
    setMessage(automatic ? 'Requesting operating-system access…' : 'Trying the permission request again…');
    try {
      const next = await requestDesktopPermission(permission);
      setStatus(next);
      if (isDesktopPermissionGranted(permission, next)) {
        advance(permission);
        return;
      }
      setAwaitingSettings(Boolean(next?.settingsOpened));
      setMessage(next?.permissionError || (next?.settingsOpened
        ? 'System Settings is open. Enable MIRA, return here, then retry or continue.'
        : 'Access was not granted. You can retry the prompt before continuing.'));
    } catch (error) {
      setMessage(error?.message || 'The permission request did not complete. Retry when ready.');
    } finally {
      setBusy(false);
    }
  }, [advance, busy]);

  useEffect(() => {
    if (!window.miraDesktop || new URLSearchParams(window.location.search).get('desktopCompanion') === '1') return;
    let active = true;
    getDesktopPermissionStatus().then((next) => {
      if (!active || !next?.available) return;
      setPlatform(next.platform || window.miraDesktop.platform || '');
      setStatus(next);
      const runningKey = `mira-desktop-permissions-running-v2`;
      if (localStorage.getItem(keys.completed) !== 'yes' && sessionStorage.getItem(runningKey) !== 'yes') setVisible(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!visible || !current || !status || busy) return;
    if (isDesktopPermissionGranted(current.id, status)) {
      advance(current.id);
      return;
    }
    const attemptKey = `${platform}:${current.id}`;
    if (automaticAttemptRef.current.has(attemptKey)) return;
    automaticAttemptRef.current.add(attemptKey);
    requestCurrent(current.id, { automatic: true });
  }, [advance, busy, current, platform, requestCurrent, status, visible]);

  useEffect(() => {
    if (!visible || !current) return undefined;
    const refresh = () => getDesktopPermissionStatus().then((next) => {
      setStatus(next);
      if (isDesktopPermissionGranted(current.id, next)) advance(current.id);
    }).catch(() => {});
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [advance, current, visible]);

  if (!visible || !current) return null;
  const progress = `${index + 1} of ${sequence.length}`;
  const canContinue = !busy && (awaitingSettings || Boolean(message) || current.requiresConfirmation);

  return (
    <div className="desktop-permission-overlay desktop-first-run-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-onboarding-title">
      <section className="desktop-permission-dialog desktop-first-run-dialog">
        <div className="desktop-permission-heading">
          <div>
            <span className="desktop-permission-eyebrow">First-run system access · {progress}</span>
            <h2 id="desktop-onboarding-title">{current.title}</h2>
          </div>
          <button type="button" onClick={() => setVisible(false)} aria-label="Finish permission setup later"><X size={18} /></button>
        </div>
        <div className="desktop-first-run-icon" aria-hidden="true"><ShieldCheck size={27} /></div>
        <p>{current.description}</p>
        <div className="desktop-permission-progress" aria-label={`Permission ${progress}`}>
          {sequence.map((permission, permissionIndex) => <span key={permission.id} className={permissionIndex <= index ? 'is-active' : ''} />)}
        </div>
        {message && <p className={isDesktopPermissionGranted(current.id, status) ? 'desktop-permission-success' : 'desktop-permission-note'} role="status">{message}</p>}
        <div className="desktop-first-run-actions">
          <button type="button" className="desktop-ide-button" disabled={busy} onClick={() => requestCurrent(current.id)}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Waiting for the system prompt…' : 'Retry permission'}
          </button>
          {canContinue && (
            <button type="button" className="desktop-ide-button is-primary" onClick={() => advance(current.id, { unresolved: !current.requiresConfirmation })}>
              {current.requiresConfirmation ? 'I enabled it' : 'Continue for now'} <ChevronRight size={14} />
            </button>
          )}
        </div>
        <button type="button" className="desktop-first-run-later" onClick={() => setVisible(false)}>Finish setup later</button>
      </section>
    </div>
  );
}

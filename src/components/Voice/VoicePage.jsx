import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RobotHead } from 'robot-heads';
import { MIRA_ROBOT_COLORS } from '../../services/miraRobotState.js';
import { getVoiceSession } from '../../services/voiceAgent.js';
import './VoicePage.css';

export default function VoicePage() {
  const current = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [caption, setCaption] = useState('');
  const [muted, setMuted] = useState(false);

  function stop() {
    const run = current.current;
    current.current = null;
    if (run) {
      run.abort.abort();
      void run.session?.endSession().catch(() => {});
      void run.audio?.close().catch(() => {});
    }
    setStatus('idle'); setMuted(false);
  }

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); stop(); };
  }, []);

  async function connect(run) {
    if (current.current !== run || run.connecting || run.session) return;
    run.connecting = true;
    setStatus('connecting'); setError('');
    try {
      const [{ Conversation }, { conversationToken }] = await Promise.all([
        import('@elevenlabs/client'), getVoiceSession(run.abort.signal),
      ]);
      if (current.current !== run) return;
      const starting = Conversation.startSession({
        conversationToken, connectionType: 'webrtc', textOnly: false,
        onModeChange: ({ mode }) => { if (current.current === run) setStatus(mode === 'speaking' ? 'speaking' : 'listening'); },
        onMessage: ({ message }) => { if (current.current === run) setCaption(message); },
        onError: () => { if (current.current === run) { stop(); setError('The voice connection was interrupted. Please enable voice again.'); } },
        onDisconnect: () => { if (current.current === run) { stop(); setCaption('Conversation ended. Enable voice to talk again.'); } },
      });
      // Stop or a timeout may win while the SDK still owns a pending microphone connection.
      void starting.then(session => { if (current.current !== run) return session.endSession(); }).catch(() => {});
      let deadline;
      const session = await Promise.race([starting, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(Error('The voice connection timed out. Please try again.')), 30000);
      })]).finally(() => clearTimeout(deadline));
      if (current.current !== run) { await session.endSession(); return; }
      run.session = session;
      setStatus('listening');
    } catch (failure) {
      if (current.current === run) { stop(); setNeedsSignIn(failure.code === 'voice/sign-in-required'); setError(failure.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then try again.' : failure.message || 'Could not start voice. Please try again.'); }
    } finally { run.connecting = false; }
  }

  async function enable() {
    if (current.current) return;
    const run = { abort: new AbortController(), connecting: false };
    current.current = run;
    setError(''); setNeedsSignIn(false); setCaption(''); setStatus('preparing');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Voice needs HTTPS and a browser with microphone support.');
      // Unlock audio in the enable gesture before starting the voice connection.
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) { run.audio = new AudioContext(); await run.audio.resume(); }
      // Authenticate first; the voice SDK acquires the microphone once when connecting.
      if (current.current !== run) return;
      await connect(run);
    } catch (failure) {
      if (current.current === run) {
        stop();
        setError(failure.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then try again.' : 'Could not enable voice. Check your microphone, then try again.');
      }
    }
  }

  const labels = { idle: 'Start a conversation with your microphone.', preparing: 'Preparing your microphone…', connecting: 'Connecting to MIRA…', listening: muted ? 'Microphone muted' : 'Listening', speaking: 'MIRA is speaking' };
  const robotState = status === 'speaking' ? 'speaking' : status === 'listening' ? 'listening' : status === 'connecting' || status === 'preparing' ? 'thinking' : 'idle';
  return <main className="mira-voice-page">
    <header><Link to="/">Back to chat</Link><span>MIRA</span><span>Voice</span></header>
    <section className="mira-voice-center" aria-label="MIRA voice conversation">
      <div className="mira-voice-mascot"><RobotHead shape="circle" state={robotState} size={280} {...MIRA_ROBOT_COLORS} antenna={false} floorShadow={false} interactive /></div>
      <h1>Talk to MIRA</h1>
      <p role="status" aria-live="polite">{labels[status]}</p>
      {caption && <p className="mira-voice-caption">{caption}</p>}
      {error && <p role="alert" className="mira-voice-error">{error}</p>}
      {needsSignIn && <Link to="/auth?reauth=1&next=%2Fvoice">Sign in to enable voice</Link>}
      <div className="mira-voice-controls">
        {status === 'idle' ? <button onClick={enable}>Start conversation</button> : <>
          {current.current?.session && <button className="secondary" onClick={() => { const value = !muted; current.current?.session?.setMicMuted(value); setMuted(value); }}>{muted ? 'Unmute' : 'Mute'}</button>}
          <button onClick={stop}>Stop</button>
        </>}
      </div>
      <p className="mira-voice-privacy">Voice is sent to ElevenLabs while connected. Leaving this page stops the conversation.</p>
    </section>
  </main>;
}

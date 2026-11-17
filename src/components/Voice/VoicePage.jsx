import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RobotHead } from 'robot-heads';
import { MIRA_ROBOT_COLORS } from '../../services/miraRobotState.js';
import { createPresenceGate } from '../../services/voicePresence.js';
import { getVoiceSession } from '../../services/voiceAgent.js';
import './VoicePage.css';

export default function VoicePage() {
  const video = useRef(null);
  const current = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [camera, setCamera] = useState(false);
  const [muted, setMuted] = useState(false);

  function stop() {
    const run = current.current;
    current.current = null;
    if (run) {
      run.abort.abort();
      clearTimeout(run.timer);
      run.stream?.getTracks().forEach(track => track.stop());
      run.detector?.close();
      void run.session?.endSession().catch(() => {});
      void run.audio?.close().catch(() => {});
    }
    if (video.current) video.current.srcObject = null;
    setStatus('idle'); setCamera(false); setMuted(false);
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
      if (current.current === run) { stop(); setError(failure.message || 'Could not start voice. Please try again.'); }
    } finally { run.connecting = false; }
  }

  async function enable(withCamera = true) {
    if (current.current) return;
    const run = { abort: new AbortController(), gate: createPresenceGate(), connecting: false };
    current.current = run;
    setError(''); setCaption(''); setStatus('preparing');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Voice needs HTTPS and a browser with microphone support.');
      // Unlock audio in the enable gesture before waiting for face presence.
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) { run.audio = new AudioContext(); await run.audio.resume(); }
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone.getTracks().forEach(track => track.stop());
      if (current.current !== run) return;
      if (!withCamera) { await connect(run); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      if (current.current !== run) { stream.getTracks().forEach(track => track.stop()); return; }
      run.stream = stream;
      video.current.srcObject = stream;
      await video.current.play();
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}voice-vision/wasm`);
      if (current.current !== run) return;
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}voice-vision/blaze_face_short_range.tflite` },
        runningMode: 'VIDEO', minDetectionConfidence: 0.65,
      });
      if (current.current !== run) { detector.close(); return; }
      run.detector = detector;
      setCamera(true); setStatus('watching');
      const detect = () => {
        if (current.current !== run) return;
        try {
          const now = performance.now();
          const face = detector.detectForVideo(video.current, now).detections.length > 0;
          if (run.gate(face, now) === 'arrived') void connect(run);
          // A short occlusion never interrupts an active conversation or repeats its greeting.
          run.timer = setTimeout(detect, 350);
        } catch { stop(); setError('Camera detection stopped. Enable voice again, or choose microphone only.'); }
      };
      detect();
    } catch (failure) {
      if (current.current === run) {
        stop();
        setError(failure.name === 'NotAllowedError' ? 'Allow microphone and camera access in your browser, then try again. You can also use microphone only.' : 'Could not enable voice and camera. Check your devices, or try microphone only.');
      }
    }
  }

  const labels = { idle: 'A conversation, face to face.', preparing: 'Preparing your microphone and camera…', watching: 'Come into view. MIRA will say hello.', connecting: 'Connecting to MIRA…', listening: muted ? 'Microphone muted' : 'Listening', speaking: 'MIRA is speaking' };
  const robotState = status === 'speaking' ? 'speaking' : status === 'listening' ? 'listening' : status === 'connecting' || status === 'preparing' ? 'thinking' : 'idle';
  return <main className="mira-voice-page">
    <header><Link to="/">Back to chat</Link><span>MIRA</span><span>Voice</span></header>
    <section className="mira-voice-center" aria-label="MIRA voice conversation">
      <div className="mira-voice-mascot"><RobotHead shape="circle" state={robotState} size={280} {...MIRA_ROBOT_COLORS} antenna={false} floorShadow={false} interactive /></div>
      <h1>Talk to MIRA</h1>
      <p role="status" aria-live="polite">{labels[status]}</p>
      {caption && <p className="mira-voice-caption">{caption}</p>}
      {error && <p role="alert" className="mira-voice-error">{error}</p>}
      <div className="mira-voice-controls">
        {status === 'idle' ? <><button onClick={() => enable(true)}>Enable voice & camera</button><button className="secondary" onClick={() => enable(false)}>Microphone only</button></> : <>
          {current.current?.session && <button className="secondary" onClick={() => { const value = !muted; current.current?.session?.setMicMuted(value); setMuted(value); }}>{muted ? 'Unmute' : 'Mute'}</button>}
          <button onClick={stop}>Stop</button>
        </>}
      </div>
      <p className="mira-voice-privacy">{camera ? 'Camera on · Presence detection on this device' : 'Camera frames stay on this device. No preview or image upload.'}<br />Voice is sent to ElevenLabs while connected. Leaving this page stops voice and camera.</p>
    </section>
    <video ref={video} muted playsInline aria-hidden="true" className="mira-voice-hidden-camera" />
  </main>;
}

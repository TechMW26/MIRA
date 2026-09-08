import { RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import { resolveMiraExpression } from '../../services/miraIdentity';
import { normalizeVoiceTranscript, sanitizeVoiceOutput } from '../../services/voiceConversation';
import MiraBloub from './MiraBloub';

const STATUS_COPY = {
  connecting: 'Preparing your voice session',
  listening: 'I’m listening',
  transcribing: 'Understanding what you said',
  thinking: 'Thinking about your request',
  speaking: 'Mira is speaking',
  error: 'Voice mode needs attention',
};

export default function VoiceModeOverlay({
  status,
  statusLabel,
  transcript,
  response,
  onClose,
  onRetry,
}) {
  const isError = status === 'error';
  const safeTranscript = normalizeVoiceTranscript(transcript);
  const safeResponse = sanitizeVoiceOutput(response);
  const expression = resolveMiraExpression({
    voiceStatus: status,
    lastMessage: safeResponse ? { role: 'assistant', content: safeResponse } : null,
    latestUserMessage: safeTranscript ? { role: 'user', content: safeTranscript } : null,
  });

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section
      className="mira-voice-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Mira voice conversation"
      data-state={status}
    >
      <div className="mira-voice-screen__glow" aria-hidden="true" />
      <header className="mira-voice-screen__header">
        <div>
          <span className="mira-voice-screen__eyebrow">MIRA VOICE</span>
          <span className="mira-voice-screen__privacy">Microphone is used only while this screen is open</span>
        </div>
        <button type="button" className="mira-voice-screen__close" onClick={onClose} aria-label="End voice conversation">
          <X size={20} />
        </button>
      </header>

      <div className="mira-voice-screen__body">
        <div className="mira-voice-avatar" data-state={status}>
          <MiraBloub
            variant="voice"
            expression={expression}
            activity={status}
          />
        </div>

        <div className="mira-voice-screen__status" role="status" aria-live="polite">
          <strong>{STATUS_COPY[status] || 'Starting voice mode'}</strong>
          <span>{statusLabel}</span>
        </div>

        <div className="mira-voice-screen__captions" aria-live="polite">
          {safeTranscript && (
            <div className="mira-voice-caption mira-voice-caption--user">
              <span>You said</span>
              <p>{safeTranscript}</p>
            </div>
          )}
          {safeResponse && (
            <div className="mira-voice-caption mira-voice-caption--mira">
              <span>Mira</span>
              <p>{safeResponse}</p>
            </div>
          )}
          {!safeTranscript && !safeResponse && !isError && (
            <p className="mira-voice-screen__hint">Speak naturally in English or Hindi. Pause when you’re done.</p>
          )}
        </div>
      </div>

      <footer className="mira-voice-screen__footer">
        {isError && (
          <button type="button" className="mira-voice-screen__retry" onClick={onRetry}>
            <RotateCcw size={17} /> Retry
          </button>
        )}
        <button type="button" className="mira-voice-screen__end" onClick={onClose}>
          <X size={17} /> End voice
        </button>
      </footer>
    </section>
  );
}

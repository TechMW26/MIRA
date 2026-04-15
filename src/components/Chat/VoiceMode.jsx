import { useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import useVoice from '../../hooks/useVoice';

export default function VoiceMode({ onSend, onClose }) {
  const { isListening, transcript, startListening, stopListening } = useVoice();
  const sent = useRef(false);

  useEffect(() => {
    startListening();
    return () => stopListening();
  }, []);

  const handleSend = useCallback(() => {
    if (transcript.trim() && !sent.current) {
      sent.current = true;
      stopListening();
      onSend(transcript.trim());
    }
  }, [transcript, onSend, stopListening]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'var(--bg-primary)' }}>

      {/* Content */}
      <div className="relative flex flex-col items-center gap-8 z-10">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-16 right-0 p-3 rounded-xl glass-subtle transition-all hover:scale-110"
          style={{ color: 'var(--text-secondary)' }}
        >
          <X size={20} />
        </button>

        {/* Mic Button */}
        <div className="relative">
          {isListening && (
            <>
              <div className="absolute inset-0 rounded-full animate-ping opacity-15 scale-150" style={{ background: 'var(--btn-primary-bg)' }} />
              <div className="absolute inset-0 rounded-full animate-pulse opacity-10 scale-[2]" style={{ background: 'var(--btn-primary-bg)' }} />
            </>
          )}
          <button
            onClick={() => isListening ? stopListening() : startListening()}
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl ${
              isListening
                ? 'scale-110'
                : 'glass-strong'
            }`}
            style={isListening ? { background: 'var(--btn-primary-bg)' } : undefined}
          >
            {isListening ? (
              <Mic size={32} style={{ color: 'var(--btn-primary-text)' }} />
            ) : (
              <MicOff size={32} style={{ color: 'var(--text-secondary)' }} />
            )}
          </button>
        </div>

        {/* Status */}
        <div className="text-center">
          <p className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            {isListening ? 'Listening...' : 'Paused'}
          </p>
          <p className="text-sm max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
            {isListening ? 'Speak now — I\'m listening' : 'Tap the mic to start'}
          </p>
        </div>

        {/* Transcript */}
        {transcript && (
          <div className="glass rounded-2xl px-6 py-4 max-w-sm text-center animate-fade-in">
            <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              "{transcript}"
            </p>
            <button
              onClick={handleSend}
              className="px-6 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

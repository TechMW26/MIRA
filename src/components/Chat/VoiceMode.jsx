import { Mic, MicOff, X, Phone } from 'lucide-react';

export default function VoiceMode({ isListening, onStart, onStop, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/95 flex flex-col items-center justify-center backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-2 text-gray-400 hover:text-white transition"
      >
        <X size={24} />
      </button>

      <div className="text-center">
        <div className="relative mb-8">
          {/* Pulse rings */}
          {isListening && (
            <>
              <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full bg-violet-500/20 voice-pulse" />
              <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full bg-violet-500/10 voice-pulse" style={{ animationDelay: '0.5s' }} />
            </>
          )}

          {/* Main button */}
          <button
            onClick={isListening ? onStop : onStart}
            className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all ${
              isListening
                ? 'bg-red-500 hover:bg-red-400 shadow-lg shadow-red-500/30'
                : 'bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/30'
            }`}
          >
            {isListening ? (
              <MicOff size={40} className="text-white" />
            ) : (
              <Mic size={40} className="text-white" />
            )}
          </button>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          {isListening ? 'Listening...' : 'Tap to speak'}
        </h2>
        <p className="text-gray-400 text-sm max-w-xs">
          {isListening
            ? 'Speak now. Your message will be sent when you pause.'
            : 'Press the microphone to start a voice conversation with MIRA.'}
        </p>
      </div>

      <button
        onClick={onClose}
        className="mt-12 flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-gray-300 transition"
      >
        <Phone size={16} />
        End Call
      </button>
    </div>
  );
}

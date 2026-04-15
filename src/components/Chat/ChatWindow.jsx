import { useRef, useEffect, useState, useCallback } from 'react';
import useChat from '../../hooks/useChat';
import useVoice from '../../hooks/useVoice';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeScreen from './WelcomeScreen';
import VoiceMode from './VoiceMode';

export default function ChatWindow() {
  const { messages, streamingContent, sendMessage, stopGenerating, isGenerating } = useChat();
  const [showVoiceMode, setShowVoiceMode] = useState(false);
  const bottomRef = useRef(null);
  const chatInputRef = useRef(null);

  const handleVoiceResult = useCallback(
    (transcript) => {
      sendMessage(transcript);
      setShowVoiceMode(false);
    },
    [sendMessage]
  );

  const {
    isListening,
    isSpeaking,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  } = useVoice(handleVoiceResult);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  function handleToggleVoice() {
    setShowVoiceMode(true);
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages && !isGenerating ? (
          <WelcomeScreen onSuggestionClick={sendMessage} />
        ) : (
          <div className="pb-4">
            {messages.map((msg, idx) => {
              const isLastAssistant =
                msg.role === 'assistant' &&
                idx === messages.length - 1 &&
                isGenerating &&
                streamingContent;

              return (
                <MessageBubble
                  key={msg.id || idx}
                  message={msg}
                  isStreaming={isLastAssistant}
                  streamingContent={isLastAssistant ? streamingContent : null}
                  onSpeak={voiceSupported ? speak : null}
                  isSpeaking={isSpeaking}
                  onStopSpeaking={stopSpeaking}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        ref={chatInputRef}
        onSend={sendMessage}
        isGenerating={isGenerating}
        onStop={stopGenerating}
        isListening={isListening}
        onToggleVoice={handleToggleVoice}
        voiceSupported={voiceSupported}
      />

      {/* Voice mode overlay */}
      {showVoiceMode && (
        <VoiceMode
          isListening={isListening}
          onStart={startListening}
          onStop={stopListening}
          onClose={() => {
            stopListening();
            setShowVoiceMode(false);
          }}
        />
      )}
    </div>
  );
}

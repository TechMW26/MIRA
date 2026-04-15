import { useState, useRef, useEffect } from 'react';
import { ArrowUp, Square, Mic, MicOff, Paperclip } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';

export default function ChatInput({ onSend, isGenerating, onStop, isListening, onToggleVoice, voiceSupported }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);
  const { model, setModel } = useChatContext();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  function handleSubmit(e) {
    e?.preventDefault();
    if (!input.trim() || isGenerating) return;
    onSend(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-gray-700/50 bg-gray-900 px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden focus-within:border-violet-500/50 transition">
          <div className="flex items-end gap-2 p-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message MIRA..."
              rows={1}
              className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm leading-6 max-h-[200px]"
            />
          </div>

          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              {/* Model selector */}
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-gray-700 text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-gray-600 outline-none focus:border-violet-500 cursor-pointer"
              >
                <optgroup label="Gemini">
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                </optgroup>
                <optgroup label="OpenAI">
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                </optgroup>
              </select>

              {/* Voice button */}
              {voiceSupported && (
                <button
                  onClick={onToggleVoice}
                  className={`p-1.5 rounded-lg transition ${
                    isListening
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700'
                  }`}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isGenerating ? (
                <button
                  onClick={onStop}
                  className="p-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition"
                  title="Stop generating"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  className="p-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition disabled:cursor-not-allowed"
                  title="Send message"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 mt-2">
          MIRA can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}

export function setInputValue(value) {
  // This is a helper for external callers — handled via ref in ChatWindow
}

import { useMemo, useState } from 'react';

export default function CanvasPanel({ messages, onClose, onRequestCanvas }) {
  const [prompt, setPrompt] = useState('');

  const canRequest = useMemo(() => prompt.trim().length > 0, [prompt]);

  return (
    <div className="h-full flex flex-col bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div className="font-semibold text-sm">Canvas</div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded hover:bg-white/10"
          aria-label="Close Canvas Panel"
        >
          Close
        </button>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        <div className="text-xs text-white/70 mb-2">
          Describe what you want to generate. This will be sent to chat as a request.
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., Create a diagram of the MIRA architecture..."
          className="w-full min-h-32 resize-none p-2 text-sm rounded bg-black/20 border border-white/10 outline-none focus:border-white/25"
        />

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (!canRequest) return;
              onRequestCanvas?.(prompt.trim());
              setPrompt('');
              onClose?.();
            }}
            disabled={!canRequest}
            className="flex-1 text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            Request Canvas
          </button>
        </div>

        {Array.isArray(messages) && messages.length > 0 && (
          <div className="mt-4 text-[11px] text-white/50">
            Using {messages.length} message(s) for context.
          </div>
        )}
      </div>

      <div className="p-3 border-t border-white/10 text-[11px] text-white/50">
        Tip: keep prompts specific and actionable.
      </div>
    </div>
  );
}

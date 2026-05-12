import { useMemo, useState } from 'react';

export default function BrowserPanel({ onSendToChat, onClose }) {
  const [query, setQuery] = useState('');

  const canSend = useMemo(() => query.trim().length > 0, [query]);

  return (
    <div className="h-full flex flex-col bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div className="font-semibold text-sm">Web Browser</div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded hover:bg-white/10"
          aria-label="Close Browser Panel"
        >
          Close
        </button>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        <div className="text-xs text-white/70 mb-2">
          Enter a query and send it to chat. (Backend will handle search/scrape if enabled.)
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., latest updates on React Server Components"
          className="w-full min-h-32 resize-none p-2 text-sm rounded bg-black/20 border border-white/10 outline-none focus:border-white/25"
        />

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (!canSend) return;
              onSendToChat?.(query.trim());
              setQuery('');
            }}
            disabled={!canSend}
            className="flex-1 text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            Search & Send
          </button>
        </div>
      </div>

      <div className="p-3 border-t border-white/10 text-[11px] text-white/50">
        Tip: use concise search terms for best results.
      </div>
    </div>
  );
}

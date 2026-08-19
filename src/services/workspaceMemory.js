const MAX_CONTEXT_EVENTS = 36;
const MAX_CONTEXT_CHARS = 36_000;

function clean(value = '', limit = 12_000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

export function buildWorkspaceMemoryPrompt(memory) {
  if (!memory || typeof memory !== 'object') return '';
  const instructions = clean(memory.instructions, 16_000);
  const seenTurns = new Set();
  const events = (Array.isArray(memory.events) ? memory.events : [])
    .slice()
    .reverse()
    .filter((event) => {
      if (event?.type !== 'chat' || !event.turnId) return true;
      if (seenTurns.has(event.turnId)) return false;
      seenTurns.add(event.turnId);
      return true;
    })
    .slice(0, MAX_CONTEXT_EVENTS)
    .reverse();
  const rendered = events.map((event) => {
    if (event?.type === 'change') {
      return `- Change: ${clean(event.path, 1_000)} (${new Date(Number(event.at) || 0).toISOString()})`;
    }
    if (event?.type !== 'chat') return '';
    return [
      `- User: ${clean(event.user, 5_000)}`,
      `  MIRA: ${clean(event.assistant, 8_000)}`,
    ].join('\n');
  }).filter(Boolean).join('\n');
  if (!instructions && !rendered) return '';
  return [
    'DESKTOP WORKSPACE MEMORY (local source of truth for the currently open folder):',
    instructions ? `Instructions from .mira/MIRA.md:\n${instructions}` : '',
    rendered ? `Recent workspace chats and changes:\n${rendered}` : '',
    'Use this context when it is relevant to the current request. Current user instructions override older workspace history.',
  ].filter(Boolean).join('\n\n').slice(0, MAX_CONTEXT_CHARS);
}

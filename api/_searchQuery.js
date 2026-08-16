function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^```(?:text)?|```$/gi, '')
    .replace(/^(?:query|search query)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function fallbackSearchQuery(latestMessage = '') {
  const exact = cleanQuery(latestMessage);
  return exact
    .replace(/^(?:hi|hello|hey|please|kindly|can you|could you|would you)[,!\.\s]+/i, '')
    .replace(/^(?:do you know about|do you know|tell me about|what is|what are|who is|search for|look up|find out about)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim() || exact;
}

export async function formSearchQuery({ latestMessage = '' } = {}) {
  const latest = String(latestMessage || '').trim();
  if (!latest) return { query: '', source: 'empty' };
  return { query: fallbackSearchQuery(latest), source: 'deterministic' };
}

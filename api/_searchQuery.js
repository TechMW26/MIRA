const GEMINI_API_URL_BASE = (process.env.GEMINI_API_URL_BASE || 'https://generativelanguage.googleapis.com/v1beta/models').trim();
const GEMINI_QUERY_MODEL = (process.env.GEMINI_QUERY_MODEL || process.env.GEMINI_PRIMARY_MODEL || process.env.GEMINI_LITE_MODEL || 'gemini-2.5-flash').trim();

function geminiKeys() {
  const csv = String(process.env.GEMINI_API_KEYS || '').trim();
  const fromCsv = csv ? csv.split(',').map((value) => value.trim()).filter(Boolean) : [];
  const fromSingles = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return Array.from(new Set([...fromCsv, ...fromSingles]));
}

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^```(?:text)?|```$/gi, '')
    .replace(/^(?:query|search query)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function messageTerms(value = '') {
  return new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && ![
        'the', 'and', 'for', 'with', 'about', 'know', 'what', 'who', 'where',
        'when', 'which', 'this', 'that', 'these', 'those', 'please', 'could',
        'would', 'should', 'tell', 'give', 'find', 'search', 'look', 'you',
        'your', 'yours', 'me', 'my', 'mine', 'our', 'ours', 'does', 'did',
      ].includes(word))
  );
}

function queryMatchesLatestMessage(query = '', latestMessage = '') {
  const latestTerms = messageTerms(latestMessage);
  if (!latestTerms.size) return true;
  const queryText = query.toLowerCase();
  return [...latestTerms].some((term) => queryText.includes(term));
}

function anchorQueryToLatestMessage(query = '', latestMessage = '') {
  const latestTerms = [...messageTerms(latestMessage)];
  const queryText = query.toLowerCase();
  const missing = latestTerms.filter((term) => !queryText.includes(term));
  if (!missing.length) return query;
  return `${missing.slice(0, 2).map((term) => `"${term}"`).join(' ')} ${query}`.trim().slice(0, 220);
}

export function fallbackSearchQuery(latestMessage = '') {
  const exact = cleanQuery(latestMessage);
  return exact
    .replace(/^(?:hi|hello|hey|please|kindly|can you|could you|would you)[,!.\s]+/i, '')
    .replace(/^(?:do you know about|do you know|tell me about|what is|what are|who is|search for|look up|find out about)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim() || exact;
}

export async function formSearchQuery({ latestMessage = '', context = '' } = {}) {
  const latest = String(latestMessage || '').trim();
  if (!latest) return { query: '', source: 'empty' };
  const keys = geminiKeys();
  if (!keys.length) return { query: fallbackSearchQuery(latest), source: 'fallback-no-key' };

  const prompt = [
    'Convert the LATEST USER MESSAGE into one precise web-search-engine query.',
    'The latest message is authoritative. Never search for an older topic unless the latest message is clearly a pronoun-only follow-up.',
    'Preserve exact product, company, person, project, model, and coined names from the latest message.',
    'If a term may be a typo or joined compound, retain the exact term and optionally add one likely variant using OR.',
    'Remove conversational filler. Add only clarifying keywords that improve retrieval.',
    'Return only the query, no label, explanation, markdown, or quotation wrapper.',
    '',
    `LATEST USER MESSAGE:\n${latest.slice(0, 1200)}`,
    context ? `\nRECENT CONTEXT (use only to resolve pronouns in the latest message):\n${String(context).slice(0, 1800)}` : '',
  ].filter(Boolean).join('\n');

  let lastError;
  for (const key of keys) {
    try {
      const response = await fetch(
        `${GEMINI_API_URL_BASE}/${encodeURIComponent(GEMINI_QUERY_MODEL)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 128,
              responseMimeType: 'text/plain',
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error(`Gemini query formation failed (${response.status})`);
      const payload = await response.json();
      const generatedQuery = cleanQuery(
        payload?.candidates?.[0]?.content?.parts
          ?.map((part) => part?.text || '')
          .join(' ')
      );
      if (!generatedQuery || generatedQuery.length < 3) {
        throw new Error('Gemini returned an empty search query.');
      }
      const query = anchorQueryToLatestMessage(generatedQuery, latest);
      if (!queryMatchesLatestMessage(query, latest)) {
        throw new Error('Gemini query drifted away from the latest message.');
      }
      return {
        query,
        source: query === generatedQuery ? 'gemini' : 'gemini-anchored',
        model: GEMINI_QUERY_MODEL,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    query: fallbackSearchQuery(latest),
    source: 'fallback-error',
    error: lastError?.message || 'Query formation failed.',
  };
}

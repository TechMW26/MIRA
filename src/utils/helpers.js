export function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = new Date();
  const diff = now - date;
  const dayMs = 86400000;

  if (diff < dayMs && date.getDate() === now.getDate()) return 'Today';
  if (diff < 2 * dayMs) return 'Yesterday';
  if (diff < 7 * dayMs) return 'Previous 7 Days';
  if (diff < 30 * dayMs) return 'Previous 30 Days';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function groupConversationsByDate(conversations) {
  const groups = {};
  for (const conv of conversations) {
    const label = formatTimestamp(conv.updatedAt || conv.createdAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return groups;
}

export function generateTitle(text) {
  const cleaned = text.replace(/[#*`]/g, '').trim();
  const words = cleaned.split(/\s+/).slice(0, 5);
  return words.join(' ') + (cleaned.split(/\s+/).length > 5 ? '…' : '');
}

/**
 * Use Gemini to generate a short 3-4 word chat title from conversation content.
 * Falls back to simple truncation if the API call fails.
 */
export async function generateSmartTitle(userMessage, assistantMessage) {
  const GEMINI_KEY = 'AIzaSyDskZLyxaQaZV26i-Ra6DbhwHf45DJnKbI';
  const model = 'gemini-2.0-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Generate a very short chat title (exactly 3-4 words, no quotes, no punctuation, no emoji) summarizing this conversation:\n\nUser: ${userMessage.slice(0, 300)}\nAssistant: ${(assistantMessage || '').slice(0, 300)}` }],
        }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 20 },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const title = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (title && title.length > 0 && title.length < 50) {
        return title.replace(/["'""]/g, '').replace(/\.+$/, '');
      }
    }
  } catch {}

  // Fallback
  return generateTitle(userMessage);
}

export function detectIntent(message) {
  const lower = message.toLowerCase();
  if (
    lower.includes('generate image') ||
    lower.includes('create image') ||
    lower.includes('draw') ||
    lower.includes('make a picture') ||
    lower.includes('generate a picture') ||
    lower.includes('create an image')
  ) {
    return 'image';
  }
  return 'chat';
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

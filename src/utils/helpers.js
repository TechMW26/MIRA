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

export async function generateSmartTitle(userMessage, assistantMessage) {
  const seed = assistantMessage && assistantMessage.trim().length > 0
    ? assistantMessage
    : userMessage;
  return generateTitle(seed);
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

const BROWSER_MARKER = /\[MIRA_BROWSER:\s*(\{[\s\S]*?\}|https?:\/\/[^\]\s]+(?:\s*\|\s*[^\]]+)?)\s*\]/i;

export function extractBrowserRequest(text = '') {
  const match = String(text || '').match(BROWSER_MARKER);
  if (!match) return null;

  const raw = match[1].trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const url = String(parsed?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return null;
      return {
        url,
        task: String(parsed?.task || parsed?.instruction || 'Inspect and document this website.').trim(),
      };
    } catch {
      return null;
    }
  }

  const [url, ...taskParts] = raw.split('|');
  if (!/^https?:\/\//i.test(url.trim())) return null;
  return {
    url: url.trim(),
    task: taskParts.join('|').trim() || 'Inspect and document this website.',
  };
}

export function isPotentialBrowserControl(text = '') {
  return /\[MIRA_BROWSER(?::[^\]]*)?$/i.test(String(text || '').trim());
}

export function stripBrowserControl(text = '') {
  return String(text || '')
    .replace(BROWSER_MARKER, '')
    .replace(/\[MIRA_BROWSER(?::[\s\S]*)?$/i, '')
    .trim();
}

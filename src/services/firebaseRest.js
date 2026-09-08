export function buildFirebaseRestUrl(databaseUrl, path = '') {
  const base = String(databaseUrl || '').replace(/\/+$/, '');
  const cleanPath = String(path || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/${cleanPath ? `${cleanPath}.json` : '.json'}`;
}

export function snapshotFromValue(value, key = null) {
  return {
    key,
    exists: () => value !== null && value !== undefined,
    val: () => value,
    forEach(callback) {
      if (!value || typeof value !== 'object') return false;
      for (const [childKey, childValue] of Object.entries(value)) {
        if (callback(snapshotFromValue(childValue, childKey)) === true) return true;
      }
      return false;
    },
  };
}

export async function fetchFirebaseSnapshot(databaseUrl, path, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(buildFirebaseRestUrl(databaseUrl, path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal: options.signal || AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Firebase recovery returned HTTP ${response.status}.`);
  return snapshotFromValue(await response.json());
}

export async function writeFirebaseValue(databaseUrl, path, value, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const method = String(options.method || 'PUT').toUpperCase();
  const response = await fetchImpl(buildFirebaseRestUrl(databaseUrl, path), {
    method,
    headers: {
      Accept: 'application/json',
      ...(method === 'DELETE' ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(value) }),
    // Realtime Database is intentionally accessed without browser cookies.
    // This avoids extension/session cookie growth interfering with persistence
    // and matches the read-side recovery transport above.
    credentials: 'omit',
    signal: options.signal || AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Firebase persistence returned HTTP ${response.status}.`);
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

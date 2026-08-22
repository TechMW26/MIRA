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

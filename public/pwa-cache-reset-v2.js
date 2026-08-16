const ACTIVE_CACHE_PREFIX = 'mira-v2-';

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const staleCacheNames = cacheNames.filter((name) => !name.startsWith(ACTIVE_CACHE_PREFIX));
    await Promise.all(staleCacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();

    if (staleCacheNames.length === 0) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
  })());
});

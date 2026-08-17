self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});

// This endpoint replaces an obsolete Firebase messaging worker. MIRA does not
// currently register Firebase Messaging, so stale pushes are intentionally ignored.
self.addEventListener('push', (event) => {
  event.waitUntil(Promise.resolve());
});

(async () => {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    const cacheNames = await globalThis.caches?.keys?.() || [];
    await Promise.all(cacheNames.map((name) => globalThis.caches.delete(name)));
  } finally {
    // A stale relative-base build can request this recovery module from a
    // nested /chat/assets path. Replace the document once its worker/cache is
    // gone so the canonical HTML can load root-relative production assets.
    globalThis.location?.reload?.();
  }
})();

export function isLegacyFirebaseMessagingWorker(registration) {
  const workers = [registration?.active, registration?.waiting, registration?.installing];
  return workers.some((worker) => /\/firebase-messaging-sw\.js(?:[?#]|$)/i.test(String(worker?.scriptURL || '')));
}

export async function removeLegacyFirebaseMessagingWorkers(serviceWorker = globalThis.navigator?.serviceWorker) {
  if (!serviceWorker?.getRegistrations) return 0;
  const registrations = await serviceWorker.getRegistrations();
  const legacy = registrations.filter(isLegacyFirebaseMessagingWorker);
  const removed = await Promise.all(legacy.map((registration) => registration.unregister().catch(() => false)));
  return removed.filter(Boolean).length;
}

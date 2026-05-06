// Self-destructing service worker.
//
// The previous implementation used a cache-first strategy for JS/CSS, which
// trapped users on stale bundles after deploys. This version installs, then
// immediately clears all caches, unregisters itself, and reloads any open
// tabs so they fetch fresh content directly from the network.
//
// After this runs once, navigator.serviceWorker has no active worker; future
// requests bypass any SW layer entirely (main.tsx no longer registers one).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        console.error('[sw] Failed to clear caches:', e);
      }

      try {
        await self.registration.unregister();
      } catch (e) {
        console.error('[sw] Failed to unregister:', e);
      }

      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => client.navigate(client.url));
      } catch (e) {
        console.error('[sw] Failed to reload clients:', e);
      }
    })()
  );
});

// No fetch handler — every request goes straight to the network.
/**
 * This file only exists to take itself away.
 *
 * Earlier versions of the game installed a service worker from this address
 * that answered every request from its cache first. The game no longer uses
 * one, but a device that loaded an earlier version still has that worker, and
 * it would keep serving the old game from its cache for ever. Browsers check
 * this address for a newer worker, so this is the one they find: it deletes
 * the old caches, unregisters itself and reloads any open pages, which then
 * come straight from the network.
 *
 * It has no fetch handler, so while it lives it does not intercept anything.
 * Once no device has the old worker any more, this file can be deleted.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('vector-rally-'))
      .map(name => caches.delete(name)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) page.navigate(page.url);
  })());
});

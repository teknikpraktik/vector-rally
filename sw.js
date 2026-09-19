/**
 * The service worker: it makes the game work offline, and — more importantly
 * in a classroom — it makes an update actually arrive.
 *
 * The version string lives in version.js and nowhere else. It is part of the
 * cache name, so a new version means a new cache; the old ones are deleted on
 * activation. Bump version.js in any commit that changes a cached file.
 */

importScripts('./version.js');

const CACHE = `vector-rally-${self.APP_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './engine.js',
  './tracks.js',
  './version.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('vector-rally-') && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Cache first, network second. Everything the game needs was precached at
// install, so this only reaches the network for something new.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
      throw error;
    }
  })());
});

const CACHE = 'wmw-v17';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  // Cache CDN scripts so the app loads correctly offline without blocking
  // network round-trips to external hosts.
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  // Take over immediately without waiting for old SW to be discarded
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Delete any caches from previous versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful same-origin responses
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // Fall back to cache if offline
    })
  );
});

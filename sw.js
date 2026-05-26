/**
 * Pichost Service Worker
 * Caches static frontend assets only — never caches authenticated API responses.
 */
const CACHE_NAME = 'pichost-static-v1';

// The index.html is the only static asset we serve from origin
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Do NOT cache API routes (/login, /list, /raw/*, /upload, etc.)
  if (url.pathname.startsWith('/api') || url.pathname === '/login' || url.pathname === '/logout' ||
      url.pathname === '/register' || url.pathname === '/google-login' || url.pathname === '/me' ||
      url.pathname === '/list' || url.pathname.startsWith('/raw/') ||
      url.pathname.startsWith('/delete/') || url.pathname.startsWith('/download/') ||
      url.pathname.startsWith('/upload')) {
    return;
  }

  // Cache-first for static assets (index.html, manifest.json)
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var fetchPromise = fetch(event.request).then(function(response) {
        // Cache successful responses
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});

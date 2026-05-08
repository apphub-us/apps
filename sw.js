// SparkyPro Service Worker v1.0
// Caches the app for offline use — AI chat requires internet, all tables work offline

var CACHE_NAME = 'sparkypro-v2';
var OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install — cache core files
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', function(event) {
  // Skip API calls — always need network for AI and Firebase
  var url = event.request.url;
  if (
    url.includes('anthropic.com') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com')
  ) {
    return; // Let these go through to network normally
  }

  // For Google Fonts — try network first, fall back to cache
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return fetch(event.request).then(function(response) {
          cache.put(event.request, response.clone());
          return response;
        }).catch(function() {
          return caches.match(event.request);
        });
      })
    );
    return;
  }

  // For app files — cache first, then network
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Cache successful responses
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback — return cached index
        return caches.match('/index.html');
      });
    })
  );
});

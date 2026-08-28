/**
 * Empire Code — service worker
 *
 * Priorities, in order:
 *   1. Never leave the app unusable offline. Electricians work in basements,
 *      electrical rooms and elevator shafts with no signal.
 *   2. Deliver safety-critical calculator updates promptly when there IS
 *      signal. The calculator engine is embedded in mobile.html, so a stale
 *      mobile.html means a stale engine.
 *   3. Never let a non-critical asset (fonts) break either of the above.
 */

const CACHE_NAME = 'empire-code-v2';

/**
 * Same-origin assets the app cannot work without. Fetched atomically with
 * cache.addAll(): if any one fails the install fails, the new worker never
 * activates, and the previous worker keeps serving. That is the correct
 * outcome — a half-populated cache is worse than an old complete one.
 */
const CRITICAL_ASSETS = [
  '/mobile.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

/**
 * Nice-to-have, third-party, and outside our control. Fetched individually
 * with failures swallowed, so a Google Fonts outage or a captive portal
 * cannot stop the app itself from being cached.
 *
 * Pre-caching (rather than relying only on runtime caching) means a user who
 * installs the app and immediately loses signal still gets correct typography.
 */
const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;600&family=Montserrat:wght@600;700;800&display=swap'
];

/**
 * Navigation network timeout, milliseconds.
 *
 * Chosen at 3000 ms deliberately:
 *   - A healthy connection returns mobile.html well inside this, so the
 *     network-first guarantee is preserved and users get calculator fixes on
 *     the very next launch.
 *   - Below ~2000 ms a merely slow-but-working connection would be abandoned
 *     too eagerly, silently serving a stale engine when a fresh one was
 *     reachable. That defeats the point of network-first for safety updates.
 *   - Above ~4000 ms the app reads as frozen. Three seconds is around the
 *     threshold where a wait stops feeling like loading and starts feeling
 *     like a fault.
 */
const NAV_TIMEOUT_MS = 3000;

// ── Install ───────────────────────────────────────────────────────────────
// Critical assets first and atomically; optional assets afterwards, never
// allowed to reject. skipWaiting() runs only once the critical set is cached.
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(CRITICAL_ASSETS).then(function () {
          return Promise.all(OPTIONAL_ASSETS.map(function (url) {
            return cache.add(url).catch(function () {
              // Fonts unavailable — runtime caching will pick them up later.
            });
          }));
        });
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// ── Activate ──────────────────────────────────────────────────────────────
// Only ever runs after install resolved, so the new cache is already fully
// populated before any old cache is deleted. There is no window in which a
// user has neither.
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE_NAME; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Store a response copy without ever rejecting into the fetch handler. */
function putInCache(request, response) {
  if (!response || response.status !== 200) return;
  var copy = response.clone();
  caches.open(CACHE_NAME)
    .then(function (cache) { return cache.put(request, copy); })
    .catch(function () { /* quota or opaque response — not fatal */ });
}

/**
 * Fetch with a deadline.
 *
 * Exactly one settle: whichever of the timer or the fetch comes first wins,
 * and the loser is neutralised. A response that arrives after the deadline is
 * still written to the cache — the download already happened, so the next
 * launch benefits — but it is not returned, because the caller has already
 * been served from cache.
 *
 * The late fetch's own rejection is swallowed rather than left dangling, so
 * this cannot produce an unhandled promise rejection.
 */
function fetchWithTimeout(request, ms) {
  return new Promise(function (resolve, reject) {
    var settled = false;

    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('EC_SW_TIMEOUT'));
    }, ms);

    fetch(request).then(
      function (response) {
        clearTimeout(timer);
        putInCache(request, response);
        if (settled) return;      // too late to serve, but the cache is warm
        settled = true;
        resolve(response);
      },
      function (err) {
        clearTimeout(timer);
        if (settled) return;      // already rejected by the timer
        settled = true;
        reject(err);
      }
    );
  });
}

function cachedOrShell(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('/mobile.html');
    return undefined;
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function (e) {
  var req = e.request;

  if (req.method !== 'GET') return;
  if (req.url.startsWith('chrome-extension')) return;

  // Live APIs must never be served from cache.
  if (req.url.indexOf('anthropic.com') !== -1 ||
      req.url.indexOf('firestore.googleapis.com') !== -1 ||
      req.url.indexOf('firebase') !== -1) {
    return;
  }

  var isAppShell = req.mode === 'navigate' ||
                   req.url.indexOf('/mobile.html') !== -1;

  if (isAppShell) {
    // Network-first WITH a deadline. Healthy network -> newest engine.
    // Slow or dead network -> cached engine within NAV_TIMEOUT_MS.
    e.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT_MS).catch(function () {
        return cachedOrShell(req);
      })
    );
    return;
  }

  // Everything else keeps the previous network-first behaviour unchanged.
  e.respondWith(
    fetch(req).then(function (response) {
      putInCache(req, response);
      return response;
    }).catch(function () {
      return cachedOrShell(req);
    })
  );
});

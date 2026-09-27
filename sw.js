// klabnet service worker.
//
// Deliberately minimal. This app is a single index.html that talks to
// Matrix, Navidrome and /api for literally everything on screen, so there
// is no meaningful offline mode to build — the service worker is here to
// make the app installable and to stop the few static assets being
// re-fetched on every cold start.
//
// The one rule that matters: NEVER serve the HTML document from a cache.
// index.html carries KLABNET_VERSION, and checkForUpdate() in the page
// re-fetches this same document every few minutes to compare that string
// and offer a reload. A cached document would freeze that check and pin
// everyone to whatever build the cache happened to capture. Navigations
// and no-store requests fall through to the network untouched.

// Bumping this name purges every previously cached asset on activate.
// That's the escape hatch when a deploy has already gone out and people are
// holding stale js/css: the worker updates on their next navigation (it's
// byte-compared on every one), the old cache is deleted, and their next
// asset request misses and goes to the network — even if their index.html
// is itself still cached and still asking for the old URLs.
// Bump this whenever a deploy MUST reach people who are already running.
const CACHE = 'klabnet-static-v57';
const PRECACHE = ['./klab.png', './manifest.json'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Lets the page retire a stuck worker without the user clearing site data.
self.addEventListener('message', event => {
  if (event.data === 'klabnet-sw-unregister') {
    self.registration.unregister().then(() => self.clients.claim());
  }
});

function isCacheable(url, request) {
  if (request.method !== 'GET') return false;
  // The document itself — see the header comment.
  if (request.mode === 'navigate') return false;
  if (request.cache === 'no-store') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return false;
  return true;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!isCacheable(url, event.request)) return; // straight to the network

  // A ?v=<KLABNET_VERSION> URL never changes: served from the cache
  // without asking the network, and when a deploy brings a new one, the
  // old versions of that file are dropped (they used to pile up, a
  // megabyte and more per deploy, forever).
  if (url.searchParams.has('v')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res && res.ok && res.type === 'basic') {
        event.waitUntil((async () => {
          await cache.put(event.request, res.clone());
          for (const req of await cache.keys()) {
            const u = new URL(req.url);
            if (u.pathname === url.pathname && u.searchParams.get('v') !== url.searchParams.get('v')) await cache.delete(req);
          }
        })());
      }
      return res;
    })());
    return;
  }

  // Everything else (the icon, the manifest, fonts): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    const network = fetch(event.request).then(async res => {
      if (res && res.ok && res.type === 'basic') await cache.put(event.request, res.clone());
      return res;
    }).catch(() => null);
    event.waitUntil(network);
    return hit || (await network) || Response.error();
  })());
});

// Desktop notifications shown through the worker (Android only allows
// those): focus klabnet and tell the page which one was clicked.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tag = event.notification.data?.tag;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!all.length) { await self.clients.openWindow('./'); return; }
    // Every window hears it; the one that showed this notification acts on it.
    if (tag) all.forEach(c => c.postMessage({ klabNotifClick: tag }));
    await (all.find(c => c.focused) || all[0]).focus();
  })());
});

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
const CACHE = 'klabnet-static-v59'; // v59: recheck had stored binary files as mangled text
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

const checked = new Set();
// A copy still found right two minutes or more after it was cached is past any
// deploy's window, and is marked so: the worker stops and starts all day,
// and every start checked every file again (forty requests) otherwise.
const SETTLED_MS = 2 * 60 * 1000;
function stamped(body, from, extra) {
  const headers = new Headers(from.headers);
  for (const k in extra) headers.set(k, extra[k]);
  return new Response(body, { status: from.status, statusText: from.statusText, headers });
}
function same(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
async function recheck(cache, request, hit, clientId) {
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (!res.ok || res.type !== 'basic') return;
    // Bytes, not text: the icon font and the pictures are binary, and a copy
    // put back from .text() came out mangled (icons gone until a hard reload).
    const [was, now] = await Promise.all([hit.arrayBuffer(), res.clone().arrayBuffer()]);
    if (same(was, now)) {
      const at = +hit.headers.get('x-klab-at') || 0;
      if (!at) await cache.put(request, stamped(now, hit, { 'x-klab-at': String(Date.now()) }));
      else if (Date.now() - at > SETTLED_MS) await cache.put(request, stamped(now, hit, { 'x-klab-ok': '1' }));
      return;
    }
    await cache.put(request, stamped(await res.blob(), res, { 'x-klab-at': String(Date.now()) }));
    const client = clientId && await self.clients.get(clientId);
    client?.postMessage({ klabAssetStale: new URL(request.url).searchParams.get('v') });
  } catch (e) {}
}

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
  // without waiting on the network, and when a deploy brings a new one,
  // the old versions of that file are dropped (they used to pile up, a
  // megabyte and more per deploy, forever).
  // "Never changes" has one hole: a page loaded mid-deploy, its new
  // index.html asking for ?v=NEW before the new file is there, gets the
  // old file under the new name. Kept forever, that was Feed broken on
  // every load until Ctrl+Shift+R (which skips this worker), and broken
  // again on the next plain one. So each one is checked against the
  // server once in the background, the first time this worker serves it;
  // a wrong copy is replaced and the page told to reload.
  if (url.searchParams.has('v')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) {
        if (!checked.has(url.href) && !hit.headers.get('x-klab-ok')) { checked.add(url.href); event.waitUntil(recheck(cache, event.request, hit.clone(), event.clientId)); }
        return hit;
      }
      const res = await fetch(event.request);
      if (res && res.ok && res.type === 'basic') {
        event.waitUntil((async () => {
          await cache.put(event.request, stamped(await res.clone().blob(), res, { 'x-klab-at': String(Date.now()) }));
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

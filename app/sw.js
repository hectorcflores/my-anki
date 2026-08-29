// Offline cache for Brain Gym. Bump CACHE when shipping new content —
// old caches are dropped on activate, so a deploy never serves a stale deck.
const CACHE = "brain-gym-202608281800";
const ASSETS = [
  "./",
  "./index.html",
  "./data.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./geist-latin.woff2",
  "./geist-latin-ext.woff2",
];

// `cache: "reload"` bypasses the browser's own HTTP cache. GitHub Pages serves
// HTML with a ten-minute max-age, so without this a fresh install can populate
// itself from the very copy it is meant to replace.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first so a fresh deck lands as soon as you're online, with the
// cache as the offline fallback. Same-origin requests skip the HTTP cache for
// the same reason install does — otherwise "network-first" can still be served
// a ten-minute-old page and it looks like the deploy never happened.
//
// Cross-origin requests (Firestore sync, once enabled) are left alone
// entirely — not routed through this handler at all. Two reasons, not one:
// this cache has no business storing someone else's API responses, and the
// offline-fallback path below (`hit || caches.match("./index.html")`) is
// actively dangerous for a JSON API call. A failed cross-origin GET would
// resolve to a *successful-looking* 200 response whose body is this app's
// own index.html — indistinguishable from a real reply until whatever parses
// it as JSON throws. Sync's own fetch() calls handle their own failures
// (queue and retry); routing them through the cache here would only add a
// way for a real failure to masquerade as a fake success.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  const req = new Request(e.request, { cache: "reload" });
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});

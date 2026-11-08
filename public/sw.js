// Minimal service worker: cache static build assets; navigations go network-first with an offline page.
// Never caches /api or authenticated pages' data.
const CACHE = "dc-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add("/offline.html"))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api")) return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).catch(() => caches.match("/offline.html"))); return; }
  if (u.pathname.startsWith("/_next/static") || u.pathname.startsWith("/icons")) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); return res; })));
  }
});

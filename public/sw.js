// Service worker. PRIVACY RULE: nothing user-specific is ever stored.
//  - Navigations (HTML for dashboards, notifications, etc.) always go to the network; the cache is used ONLY for the static offline page.
//  - The cache is an ALLOWLIST of build-time static assets (/_next/static, /icons). RSC/data/API/auth requests are never intercepted.
//  - Responses marked private/no-store, or non-OK/opaque, are never cached.
const CACHE = "dc-v2"; // v1 caches are deleted on activate
const STATIC = [/^\/_next\/static\//, /^\/icons\//];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add("/offline.html"))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).catch(() => caches.match("/offline.html"))); return; }
  if (!STATIC.some((re) => re.test(u.pathname)) || r.headers.has("authorization")) return; // anything else: browser default, uncached
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
    const cc = res.headers.get("cache-control") || "";
    if (res.ok && res.type === "basic" && !/no-store|private/i.test(cc)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  })));
});

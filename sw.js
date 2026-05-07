/* LEDGR Service Worker — offline-first cache for shell */
const VERSION = "ledgr-v3";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-config.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache supabase API or 3rd-party (CDN supabase-js)
  if (url.hostname.includes("supabase.co") || url.hostname.includes("googleapis") || url.hostname.includes("gstatic") || url.hostname.includes("jsdelivr")) {
    return; // pass through
  }
  // Same-origin shell: cache-first
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          // Cache successful responses for the shell
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => caches.match("./index.html"))
      )
    );
  }
});

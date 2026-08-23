const CACHE_NAME = "manabi-memo-shell-v4";
const APP_SHELL = ["/", "/offline.html", "/favicon.svg", "/manifest.webmanifest", "/pdf.worker.min.mjs"];

self.addEventListener("install", (event) => {
  // One missing asset should not prevent the service worker from installing.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map(async (asset) => {
    try { await cache.add(asset); } catch { /* the runtime fetch can retry it later */ }
  }))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/")
    || url.pathname === "/signin-with-chatgpt"
    || url.pathname === "/signout-with-chatgpt"
    || url.pathname === "/callback"
    || url.pathname === "/feedback-admin"
  ) return;

  const staticAsset = url.pathname.startsWith("/_next/static/")
    || url.pathname === "/favicon.svg"
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === "/pdf.worker.min.mjs";

  event.respondWith(staticAsset ? cacheFirst(event.request) : networkFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return networkFirst(request);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && !/no-store|private/i.test(response.headers.get("cache-control") || "")) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return (await caches.match("/")) || (await caches.match("/offline.html"));
    return Response.error();
  }
}

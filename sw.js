const CACHE_NAME = "plandeferme-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/geolibre-contour.css",
  "/geolibre-contour.js",
  "/flatgeobuf-geojson.min.js",
  "/marked.min.js",
  "/manifest.webmanifest",
  "/favicon/favicon.ico",
  "/favicon/favicon-192.png",
  "/favicon/favicon-512.png",
  "/logos/logo_plandeferme_v3_joyeux.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

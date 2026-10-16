const CACHE_NAME = "plandeferme-v5";

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
  "/logos/logo_plandeferme_v3_joyeux.png",
  "/data/wms-catalog.json",
  "/js/config.js",
  "/js/topo.js",
  "/js/hydro.js",
  "/js/ndvi.js",
  "/js/soil-ai.js",
  "/js/wms.js",
  "/js/app.js"
];

// Installation : pré-caching robuste des actifs essentiels et activation immédiate
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Échec pré-cache pour ${url}:`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activation : purge immédiate de TOUS les anciens caches (ex: plandeferme-v1) et prise de contrôle
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.log("[SW] Suppression de l'ancien cache:", key);
          return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Laisser passer sans interférence les requêtes tierces (MapLibre, tuiles MNT/Sentinel, API...)
  if (url.origin !== location.origin) {
    return;
  }

  // 1. Pages HTML / Navigation : NETWORK-FIRST avec secours Cache
  // L'utilisateur connecté reçoit TOUJOURS la dernière version lors d'un rechargement normal,
  // tout en conservant le fonctionnement hors-ligne complet sans réseau.
  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") && request.headers.get("accept").includes("text/html")) ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/index.html");
          if (fallback) return fallback;
          return caches.match("/");
        })
    );
    return;
  }

  // 2. Scripts et styles locaux (.js, .css) : NETWORK-FIRST avec secours Cache
  // Permet de propager immédiatement les corrections et nouvelles fonctionnalités sans cache résiduel
  const isCodeAsset = url.pathname.endsWith(".js") || url.pathname.endsWith(".css");

  if (isCodeAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response("Ressource indisponible hors-ligne", { status: 503 });
        })
    );
    return;
  }

  // 3. Autres actifs statiques (images, favicons, manifest) : STALE-WHILE-REVALIDATE
  // Affichage instantané depuis le cache avec mise à jour en tâche de fond
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Erreur réseau ignorée en arrière-plan
        });

      return cached || fetchPromise;
    })
  );
});

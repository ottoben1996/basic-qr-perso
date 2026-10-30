const CACHE = "basicqr-v13";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=13",
  "./app.js?v=13",
  "./src/core.js?v=13",
  "./src/scan.js?v=13",
  "./src/theme-boot.js?v=13",
  "./src/qrcode.js?v=13",
  "./src/fonts/archivo-latin.woff2?v=13",
  "./src/fonts/archivo-latin-ext.woff2?v=13",
  "./manifest.webmanifest?v=13",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Navigation : réseau d'abord, pour que la dernière version s'affiche tout de
  // suite ; le cache ne sert qu'en secours hors ligne.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(request)) || (await caches.match("./index.html")) || Response.error();
        })
    );
    return;
  }

  // Ressources : cache d'abord, rafraîchissement en arrière-plan.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

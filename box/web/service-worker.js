const CACHE_NAME = "boxingcoach-shell-2026-09-23-2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/preview.html",
  "/styles.css",
  "/styles/operations.css",
  "/scripts/center.js",
  "/scripts/i18n.js",
  "/scripts/operations-service.js",
  "/scripts/operations-ui.js",
  "/scripts/operations-commerce.js",
  "/scripts/operations-shell.js",
  "/scripts/operations-views.js",
  "/scripts/operations-people.js",
  "/scripts/operations-live.js",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/app-icon.svg",
  "/icons/app-icon-maskable.svg",
  "/scripts/accounts.js",
  "/scripts/android-offline.js",
  "/scripts/auth-shell.js",
  "/scripts/business.js",
  "/scripts/config.js",
  "/scripts/desktop-bridge.js",
  "/scripts/member-home.js",
  "/scripts/platform-admin.js",
  "/scripts/preferences.js",
  "/scripts/pwa.js",
  "/scripts/session.js",
  "/scripts/motion-session.js",
  "/scripts/motion-pipeline.mjs",
  "/scripts/motion-skeleton.mjs",
  "/scripts/motion-worker.js",
  "/scripts/motion-round.mjs",
  "/scripts/motion-features.mjs",
  "/scripts/motion-recognizer.mjs",
  "/scripts/round-coach.js",
  "/scripts/coach-conversation.mjs",
  "/scripts/coach-summary.mjs",
  "/scripts/coach-api.js",
  "/scripts/coach-voice.mjs",
  "/styles/round-coach.css",
  "/scripts/storage.js",
  "/scripts/utils.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    const documentPath = url.pathname === "/" ? "/index.html" : url.pathname;
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok && ["/index.html", "/preview.html"].includes(documentPath)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(documentPath, response.clone());
          }
          return response;
        })
        .catch(async () => (await caches.match(documentPath)) || new Response("오프라인에서 이 페이지를 열 수 없습니다.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })
  );
});

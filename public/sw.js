/*
 * Offline-shell service worker (dependency-free).
 *
 *  - Precaches the app shell on install so the app opens with last-known UI
 *    even on a poor connection.
 *  - Navigations: network-first, falling back to cache, then an offline page.
 *  - Static assets (_next, icons, fonts): stale-while-revalidate.
 *  - Never caches API / live-score requests — those always need the network.
 *
 * Bump VERSION to invalidate old caches on the next activation.
 */
const VERSION = "v2";
const SHELL_CACHE = `lms-shell-${VERSION}`;
const RUNTIME_CACHE = `lms-runtime-${VERSION}`;

const SHELL = [
  "/",
  "/standings",
  "/account",
  "/login",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {
        /* a missing shell entry shouldn't block install */
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave ESPN / cross-origin alone
  if (url.pathname.startsWith("/api/")) return; // never cache live data

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match("/")) ||
            (await cache.match("/offline")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});

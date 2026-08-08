/**
 * The offline-shell service worker, served from a route rather than `public/`.
 *
 * Why a route: a static `public/sw.js` is byte-identical across deploys, so the
 * browser's update check finds no change, `install`/`activate` never re-run, and
 * the caches from the very first visit live forever. Once a cache outlives the
 * build it was filled from, the app can boot with stale JS whose Server Action
 * IDs no longer exist on the server — Next then throws `UnrecognizedActionError`
 * and the screen goes blank. Stamping BUILD_ID into the source makes every
 * deploy a real update, which is what drives the cache purge in `activate`.
 */

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

// Precache the offline fallback and the PWA chrome only. Deliberately NOT the
// app's HTML routes: that HTML names build-specific JS chunks, so caching it
// lets a whole superseded build come back to life on one offline navigation.
const source = `/*
 * Offline-shell service worker (dependency-free). Generated per build.
 *
 *  - Precaches the offline fallback + PWA chrome on install.
 *  - Navigations: network-first, falling back to the offline page.
 *  - Static assets (_next, icons, fonts): stale-while-revalidate. Safe because
 *    Next's asset filenames are content-hashed and old caches are purged below.
 *  - Never caches API / live-score requests — those always need the network.
 */
const VERSION = ${JSON.stringify(BUILD_ID)};
const SHELL_CACHE = "lms-shell-" + VERSION;
const RUNTIME_CACHE = "lms-runtime-" + VERSION;

const SHELL = [
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
      // Drop every cache from an older build. VERSION changes each deploy, so
      // this now actually fires instead of matching the same name forever.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("lms-") && !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
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
  if (url.pathname === "/sw.js") return; // never cache ourselves

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/offline")) || Response.error();
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
`;

// Fixed at build time, so let it be prerendered as a static asset.
export const dynamic = "force-static";

export function GET() {
  return new Response(source, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Root scope so the worker can control /app/* from /sw.js.
      "Service-Worker-Allowed": "/",
      // Must revalidate, or the browser caches the worker and never sees a new build.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

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

/**
 * Emergency escape hatch. Set NEXT_PUBLIC_DISABLE_SW=1 in the Netlify env and
 * redeploy: every browser that checks for a worker update then receives one
 * that tears down its own caches and unregisters itself. Without this, a bad
 * worker can only be cleared per-device by hand, which is impossible to ask of
 * a league full of people.
 */
const DISABLED = process.env.NEXT_PUBLIC_DISABLE_SW === "1";

const killSwitch = `// Service worker disabled via NEXT_PUBLIC_DISABLE_SW.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("lms-")).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
`;

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
  // The header mark, on screen on every authenticated route. It lives under
  // /icons/ precisely so the runtime handler below will cache it at all — and
  // precaching it here means it is there on first install rather than after the
  // first online render. NB: addAll is atomic, so every path in this array must
  // actually exist or NOTHING gets precached.
  "/icons/app-mark.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(SHELL);
      } catch {
        // One unreachable shell entry must not strand this worker in "waiting"
        // behind its predecessor — that is exactly the stale-build trap this
        // worker exists to prevent. Precaching is an optimisation; activating
        // is the job. So swallow the failure and carry on.
      }
      await self.skipWaiting();
    })(),
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

  // Only ever cache content-addressed assets. Their filenames carry a build
  // hash, so a cache hit can never be the wrong version — and anything else
  // (a bare .css, an un-hashed script) is left entirely to the browser rather
  // than risking a stale copy of a file whose name doesn't change.
  const cacheable =
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  if (!cacheable) return;

  if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);

        if (cached) {
          // Serve the hit; refresh in the background without blocking the page.
          event.waitUntil(
            fetch(req)
              .then((res) => (res && res.status === 200 ? cache.put(req, res.clone()) : undefined))
              .catch(() => {}),
          );
          return cached;
        }

        // Nothing cached, so go to the network and let a genuine failure reject.
        // The previous version resolved to undefined here, and responding with
        // undefined fails the request outright — which is how a page ends up
        // rendering with no stylesheet at all.
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
`;

// Fixed at build time, so let it be prerendered as a static asset.
export const dynamic = "force-static";

export function GET() {
  return new Response(DISABLED ? killSwitch : source, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Root scope so the worker can control /app/* from /sw.js.
      "Service-Worker-Allowed": "/",
      // Must revalidate, or the browser caches the worker and never sees a new build.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

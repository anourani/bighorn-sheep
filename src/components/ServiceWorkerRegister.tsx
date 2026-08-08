"use client";

import { useEffect } from "react";

/**
 * Registers the offline-shell service worker, and — just as importantly — keeps
 * it current.
 *
 * Registering once and walking away is what lets a superseded build linger: the
 * worker keeps serving caches filled by an older release, and eventually the
 * page is running client JS whose Server Action IDs the deployed server no
 * longer recognises. So we also poll for an update whenever the tab comes back
 * to the foreground, and reload once when a new worker takes over.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    // Whether a worker was already in charge when this page loaded. On a first
    // install `controller` is null and control arrives moments later — that is
    // not a version change, so it must not trigger a reload.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    let registration: ServiceWorkerRegistration | undefined;

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          registration = reg;
          document.addEventListener("visibilitychange", checkForUpdate);
        })
        .catch(() => {
          /* registration is best-effort; the app works without it */
        });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);
  return null;
}

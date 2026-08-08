"use client";

import { useEffect } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { InfoIcon } from "@/components/icons";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";

/**
 * Error boundary for the authenticated app.
 *
 * Without this, any throw inside /app renders Next's built-in fallback — the
 * bare "Application error: a client-side exception has occurred" with nothing
 * actionable and no way out but a manual refresh. Here we surface the digest
 * (the handle for the server-side log) and, when the failure is just a stale
 * build, recover on our own.
 *
 * Next redacts server error messages in production and leaves only `digest`;
 * client-side errors keep their message. Both are shown when present.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isStaleDeploymentError(error)) reloadOnce();
  }, [error]);

  const stale = isStaleDeploymentError(error);

  return (
    <Panel className="p-card">
      <MonoLabel className="text-onsurface-mute">Something broke</MonoLabel>
      <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">
        {stale ? "Updating to the latest version…" : "This screen didn't load"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-onsurface-mute">
        {stale
          ? "The app was updated while you had it open. Reloading now — your league is safe."
          : "Something went wrong on our end. Try again, and if it keeps happening the reference below will help track it down."}
      </p>

      {!stale && (error.message || error.digest) ? (
        <div className="mt-4 rounded-control border border-white/15 bg-white/[0.06] px-3 py-2.5">
          {error.message ? (
            <p className="break-words font-mono text-xs leading-relaxed text-onsurface">
              {error.message}
            </p>
          ) : null}
          {error.digest ? (
            <p className="mt-1 font-mono text-xs text-onsurface-mute">digest: {error.digest}</p>
          ) : null}
        </div>
      ) : null}

      {!stale ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="subtle" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-onsurface-mute">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Still stuck? A hard refresh clears any cached copy of an older release.
      </p>
    </Panel>
  );
}

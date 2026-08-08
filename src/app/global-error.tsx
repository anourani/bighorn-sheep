"use client";

import { useEffect } from "react";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";

/**
 * Last-resort boundary: catches throws from the root layout itself, which the
 * per-route error.tsx files never see. It replaces the whole document, so it
 * ships its own <html>/<body> and inline styles — none of the app's CSS or
 * fonts are guaranteed to have loaded at this point.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isStaleDeploymentError(error)) reloadOnce();
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#FBFBFC",
          color: "#1A1C1F",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: "34rem", width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6B7280",
            }}
          >
            Last Man Standing
          </p>
          <h1 style={{ margin: "8px 0 0", fontSize: "22px", lineHeight: 1.25, fontWeight: 600 }}>
            The app failed to start
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: 1.6, color: "#4B5563" }}>
            Reloading usually fixes this. If it keeps happening, the reference below identifies the
            failure in our logs.
          </p>

          {error.message || error.digest ? (
            <div
              style={{
                marginTop: "16px",
                border: "1px solid #E5E7EB",
                borderRadius: "10px",
                background: "#FFFFFF",
                padding: "10px 12px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "12px",
                lineHeight: 1.6,
                overflowWrap: "break-word",
              }}
            >
              {error.message ? <div>{error.message}</div> : null}
              {error.digest ? (
                <div style={{ marginTop: "4px", color: "#6B7280" }}>digest: {error.digest}</div>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: "44px",
                padding: "0 18px",
                border: "none",
                borderRadius: "10px",
                background: "#ED7B46",
                color: "#FFFFFF",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "44px",
                padding: "0 18px",
                border: "1px solid #D1D5DB",
                borderRadius: "10px",
                background: "#FFFFFF",
                color: "#1A1C1F",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload the app
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

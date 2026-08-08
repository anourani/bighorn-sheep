/**
 * Surviving a deploy that lands mid-session ("build skew").
 *
 * Server Action IDs and chunk filenames are build-time hashes. A tab opened
 * before a deploy still holds the old client bundle, so its next Server Action
 * POSTs an ID the new server has never heard of: the request 404s and Next
 * throws `UnrecognizedActionError`, which — uncaught — blanks the screen with
 * "Application error: a client-side exception has occurred".
 *
 * There is no way to satisfy that request; the only cure is to reload onto the
 * current build. These helpers detect the condition and reload at most once per
 * minute, so a genuinely broken deploy can't put the tab in a refresh loop.
 */

const GUARD_KEY = "lms:last-skew-reload";
const GUARD_WINDOW_MS = 60_000;

/** Is this error the symptom of a client bundle older than the server? */
export function isStaleDeploymentError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const text = `${err.name ?? ""} ${err.message ?? ""}`;
  return (
    // Server Action IDs the deployed server no longer knows.
    text.includes("UnrecognizedActionError") ||
    text.includes("Failed to find Server Action") ||
    text.includes("was not found on the server") ||
    // The other half of a skewed build: chunks that 404.
    text.includes("ChunkLoadError") ||
    text.includes("Loading chunk") ||
    text.includes("Failed to fetch dynamically imported module")
  );
}

/**
 * Reload onto the current build. Returns false (without reloading) if we already
 * tried within the guard window — the caller should then show a real error
 * instead, because reloading clearly isn't fixing it.
 */
export function reloadOnce(): boolean {
  if (typeof window === "undefined") return false;

  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(GUARD_KEY)) || 0;
  } catch {
    // Storage blocked (private mode / embedded). Fall through and allow it —
    // an occasional extra reload beats a permanently dead screen.
  }
  if (Date.now() - last < GUARD_WINDOW_MS) return false;

  try {
    window.sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    /* best effort */
  }
  window.location.reload();
  return true;
}

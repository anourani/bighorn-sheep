/**
 * The product's own name — the one identity that does NOT change with the
 * league you're viewing.
 *
 * It lives in a constant because the app names itself in nine places (this
 * header, `app/layout.tsx`'s metadata, `manifest.webmanifest`, the landing
 * page, the login explainer, `global-error.tsx`), and a second hardcoded
 * literal is how the browser tab and the header end up disagreeing.
 *
 * The other eight sites still say "Last Man Standing" and are a deliberate
 * follow-up: several are prose, not labels ("Last Man Standing is invite-only.
 * Ask a league admin…"), so the rename is a copy edit rather than a
 * substitution. Import this constant there rather than typing the string.
 */
export const APP_NAME = "Sheep with Glasses";

/**
 * The same name, initialised, for the one place that has no room for it: the
 * app header's identity block, which now shares its row with the tab pill and
 * the account button.
 *
 * Derived rather than typed out, so renaming {@link APP_NAME} can't leave a
 * stale acronym behind in the chrome. It is only ever read by `AppHeader`; every
 * other site — metadata, the manifest, the landing page, the login explainer —
 * wants the full name and should keep importing that.
 */
export const APP_SHORT_NAME = APP_NAME.split(" ")
  .map((word) => word[0]?.toUpperCase() ?? "")
  .join("");

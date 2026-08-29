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
 *
 * Neither header spells it any more. Both are pills holding a mark and some
 * buttons, so the name survives in the chrome only as an accessible one — the
 * signed-in mark's `aria-label` (it is a link) and the signed-out mark's `alt`
 * (it isn't). `APP_SHORT_NAME` lived here alongside it: the initials, for the
 * signed-out header's wordmark, which was that constant's only reader. The
 * signed-out redesign dropped the wordmark, so it was deleted rather than left
 * behind — see `git log` if the acronym is ever wanted again.
 */
export const APP_NAME = "Sheep with Glasses";

/**
 * Where "Please venmo …" on the account page's buy-in card points, and the
 * handle it prints.
 *
 * Two constants rather than deriving the label from the URL: Venmo's own
 * profile slug is capitalised (`Alex-Nourani-1`) and the mock-up prints it in
 * lower case, so a `split("/").pop()` would quietly change the design.
 *
 * League-specific data living in code, like the buy-in amount used to be. It is
 * a smaller problem than that was — the payee is the commissioner, and the app
 * runs one league — but it is the same problem, and this is the one line to
 * change if the pot ever moves.
 */
export const VENMO_URL = "https://www.venmo.com/u/Alex-Nourani-1";
export const VENMO_HANDLE = "alex-nourani-1";

/**
 * Where the "Feedback" control in Additional Settings goes.
 *
 * ⚠️ PLACEHOLDER. This is meant to be a form (Google Forms, Tally, Typeform) and
 * is a `mailto:` until that URL exists — the tile is in the design and shipping
 * it pointed at nothing would be worse than shipping it pointed at an inbox.
 * Swapping in an `https://` URL here is the whole change; the link opens in a
 * new tab either way, which a `mailto:` handles fine.
 */
export const FEEDBACK_URL =
  "mailto:nourani1alex@gmail.com?subject=Sheep%20with%20Glasses%20feedback";

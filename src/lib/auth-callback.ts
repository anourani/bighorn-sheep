/**
 * Stable reason codes for the magic-link callback, and the one honest way to
 * tell them apart.
 *
 * These end up in `/login?error=<reason>` and are keyed against a copy
 * dictionary there — the same convention the server actions use. Database or
 * auth-provider text never goes in the URL; the detail goes to `console.error`
 * and lands in the Netlify function logs.
 */
export type CallbackError =
  | "link_missing_code"
  | "verifier_missing"
  | "link_expired"
  | "entry_closed"
  | "invalid_code"
  | "join_failed";

/**
 * Is the PKCE code verifier present for this request?
 *
 * Sign-in is a two-part handshake: `signInWithOtp` stores a random verifier in
 * a cookie on the origin that asked for the link, and the emailed `code` is
 * only redeemable alongside it. `@supabase/ssr` names that cookie
 * `<storageKey>-code-verifier` and finds it the same way (see its
 * `cookies.js`), so matching the suffix is matching the library, not guessing.
 *
 * Its absence is the difference between two failures that are otherwise
 * identical from the outside — and that GoTrue can report identically, since a
 * missing verifier and an already-spent code both surface as a dead flow state.
 * Reading the cookie is a fact; parsing the error message would be a hunch.
 */
export function hasVerifierCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((name) => name.endsWith("-code-verifier"));
}

/** Only the fields we read. Structural, so an `AuthError` fits without an import. */
type ExchangeError = { name?: string; code?: string };

/**
 * Why `exchangeCodeForSession` refused, phrased so the login page can say
 * something a person can act on.
 *
 * No verifier means the link was opened somewhere its handshake never started:
 * a different browser, a different device, or — the reason this function
 * exists — a different *origin*, because the Supabase Site URL pointed at a
 * Netlify deploy permalink instead of the site. Everything else is the ordinary
 * case: the link really was used already, or it timed out.
 *
 * Two independent signals, because either alone can go stale:
 *
 *   1. auth-js checks storage itself and throws `AuthPKCECodeVerifierMissingError`
 *      (`pkce_code_verifier_not_found`) *before* it calls GoTrue. That is the
 *      direct answer — and note it never reaches Supabase, so this failure
 *      leaves no trace in the Supabase auth logs at all.
 *   2. The cookie jar. If a future auth-js renames that error, an absent
 *      verifier cookie still says the same thing.
 *
 * `cookieNames` must be read *before* the exchange: auth-js deletes the
 * verifier on any failure, so reading afterwards makes every failure look like
 * a missing verifier.
 */
export function exchangeFailureReason(
  error: ExchangeError | null | undefined,
  cookieNames: readonly string[],
): CallbackError {
  const verifierMissing =
    error?.code === "pkce_code_verifier_not_found" ||
    error?.name === "AuthPKCECodeVerifierMissingError" ||
    !hasVerifierCookie(cookieNames);
  return verifierMissing ? "verifier_missing" : "link_expired";
}

/** Map a `join_by_invite` failure onto a reason code. Postgres text never escapes. */
export function joinFailureReason(message: string): CallbackError {
  if (message.includes("entry_closed")) return "entry_closed";
  if (message.includes("invalid_code")) return "invalid_code";
  return "join_failed";
}

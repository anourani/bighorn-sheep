/**
 * Which league the app is currently "in".
 *
 * A player can belong to several leagues, but every screen — My Picks,
 * Standings, the header survivor strip — renders exactly one. That choice is a
 * cookie rather than a URL segment or a column: it has to survive a cold start
 * on a phone, it is per-device rather than per-account, and making it a route
 * param would mean rewriting every link in the app.
 *
 * `selectLeague` (src/app/app/actions.ts) writes the cookie; `loadLeague` and
 * `loadAccount` read it through {@link resolveActiveGroupId}.
 */
export const ACTIVE_LEAGUE_COOKIE = "lms_active_league";

/**
 * Pick the active league from the viewer's memberships.
 *
 * `preferred` is untrusted — it is whatever a cookie or a caller supplied, and
 * it goes stale the moment a player leaves a league (or opens the app signed in
 * as someone else on a shared device). Anything that is not a current membership
 * falls back to the earliest-joined league, which is the app's long-standing
 * default and the one the header showed before a switcher existed.
 *
 * @param memberIds group ids the viewer belongs to, earliest-joined first.
 * @returns the active group id, or null when the viewer is in no leagues.
 */
export function resolveActiveGroupId(
  memberIds: readonly string[],
  preferred?: string | null,
): string | null {
  if (memberIds.length === 0) return null;
  if (preferred && memberIds.includes(preferred)) return preferred;
  return memberIds[0]!;
}

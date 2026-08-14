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

/**
 * One entry in the header's league switcher. Deliberately just an id and a
 * name — the menu lists leagues and nothing else, so it needs neither the
 * `Group` shape nor `AccountData`'s much heavier `LeagueSummary` (role,
 * status, strikes, buy-in, phase, counts).
 */
export interface LeagueOption {
  id: string;
  name: string;
}

/**
 * Project the viewer's memberships onto the group rows fetched for them.
 *
 * The order is the whole point. `loadLeague` reads memberships ordered by
 * `joined_at` and then fetches the groups with `.in("id", …)`, which returns
 * rows in *arbitrary* order. Re-projecting through `memberIds` restores
 * earliest-joined-first, so the switcher agrees with
 * {@link resolveActiveGroupId}'s fallback instead of naming a different league
 * as "first" than the one a stale cookie actually resolves to.
 *
 * Ids with no matching row are dropped rather than rendered blank: RLS can hide
 * a group the membership row still points at, and a nameless option in a native
 * `<select>` is an unlabelled, unpickable dead entry.
 *
 * @param memberIds group ids the viewer belongs to, earliest-joined first.
 * @param groups the group rows, in any order.
 */
export function toLeagueOptions(
  memberIds: readonly string[],
  groups: readonly { id: string; name: string }[],
): LeagueOption[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const options: LeagueOption[] = [];
  for (const id of memberIds) {
    const group = byId.get(id);
    if (group) options.push({ id: group.id, name: group.name });
  }
  return options;
}

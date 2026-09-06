/**
 * Client-side display preferences, kept in `localStorage`.
 *
 * These are per-device by design, not per-account: they say how you like to look
 * at the pick screen on the phone in your hand, which is not a fact about your
 * league membership. A profile column would have meant a migration, and every
 * migration in this repo has to be applied to production by hand.
 *
 * The parsing half lives here, free of React and of `window`, so it is testable
 * under vitest's Node environment. {@link useStoredChoice} is the hook over it.
 */

/** Storage keys. Namespaced so they can be found and cleared as a group. */
export const PICKS_LAYOUT_KEY = "lms:picks:layout";

/**
 * Which entry the pick screen is showing, for a player holding two (0017).
 *
 * Per-device like its neighbour, and for a stronger reason than layout: this is
 * a view, not a commitment. Nothing is written to the database by switching
 * tabs — the entry travels with each `submitPick` call — so a stale value in one
 * browser cannot desync anything. The value is the entry number as a string,
 * which {@link readStoredChoice} narrows against `["1", "2"]` exactly as it
 * narrows the layout, so a "3" left by a future build falls back rather than
 * reaching a component that has no such tab.
 *
 * A player who has only one entry never reads it: `MyPicksClient` renders no
 * switcher, and the stored value (possibly "2", from before an entry was
 * removed in the SQL editor) is ignored in favour of the entry they actually
 * hold.
 */
export const PICKS_ENTRY_KEY = "lms:picks:entry";

/**
 * Narrow whatever came out of storage back to one of `allowed`.
 *
 * Everything unrecognised falls back: a missing key, a value written by an older
 * build whose options have since been renamed, and outright junk from another
 * script sharing the origin. The return type is the union, so a stale string can
 * never reach a `switch` that has no branch for it.
 */
export function readStoredChoice<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw == null) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

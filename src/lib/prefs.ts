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
export const PICKS_SORT_KEY = "lms:picks:sort";

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

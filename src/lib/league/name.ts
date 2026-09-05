/**
 * Player identity display. We store a real first + last name and render everyone
 * uniformly as "First L." (e.g. "Alex N.") — there is no free-text display name.
 * Both helpers are total: they never return an empty string, so an avatar circle
 * or a name label is always populated even for legacy / partial data.
 */

/** "Alex", "Nourani" → "Alex N.". Last name optional; falls back when both blank. */
export function formatDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = "Player",
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (!first && !last) return fallback.trim() || "Player";
  if (!last) return first;
  if (!first) return `${last[0]!.toUpperCase()}.`;
  return `${first} ${last[0]!.toUpperCase()}.`;
}

/**
 * Avatar initials: first-initial + last-initial ("AN"). With no last name, uses
 * the first two letters of the first name; guarantees a non-empty result ("?").
 */
export function initials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return (first[0]! + last[0]!).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last) return last.slice(0, 2).toUpperCase();
  return "?";
}

/**
 * "Alex", "Nourani" → "Alex Nourani". The unabbreviated form, for the one screen
 * that administers real people rather than displaying them to the league: the
 * admin Control Center's roster. Everywhere else still renders `formatDisplayName`.
 *
 * Total on the same terms as its siblings — either name may be missing, and a
 * profile with neither still gets the fallback rather than an empty cell. Note
 * the last-name-only case differs from `formatDisplayName`, which abbreviates it
 * to "R."; there is nothing to abbreviate when the whole name is on show.
 */
export function formatFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = "Player",
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (!first && !last) return fallback.trim() || "Player";
  if (!last) return first;
  if (!first) return last;
  return `${first} ${last}`;
}

/**
 * The roster in alphabetical order, as a NEW array — the caller's is a prop.
 *
 * Sorted on the string `formatFullName` renders, which is what makes this
 * "alphabetical" in the sense a reader means it: the column scans in the order
 * the eye reads it. It also buys the surname tiebreak for free — "Alex Adams"
 * before "Alex Nourani" — with no second comparator field to keep in step with
 * the label.
 *
 * `sensitivity: "base"` so case and accents never split two names that read as
 * neighbours, and `id` as the final key so equal labels (including everyone
 * sharing the blank-name fallback) still land in a fixed order. Without that
 * last key the sort is not deterministic, and a roster that reshuffles under an
 * admin's cursor is the thing this replaced.
 *
 * Generic rather than typed to `Member`: this module is a leaf with no imports,
 * and it stays one.
 */
export function sortRosterByName<
  T extends { id: string; firstName: string; lastName: string },
>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
    const byName = formatFullName(a.firstName, a.lastName).localeCompare(
      formatFullName(b.firstName, b.lastName),
      undefined,
      { sensitivity: "base" },
    );
    return byName || a.id.localeCompare(b.id);
  });
}

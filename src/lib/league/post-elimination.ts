/**
 * Whether a regular-season week falls AFTER an entry was eliminated — the one
 * predicate behind "an eliminated entry keeps picking, privately".
 *
 * An entry that has gone out may carry on making picks for the weeks that
 * follow, on its own picks page and nowhere else. Those picks must never reach
 * the standings board, the headcount, the admin Picks tab or another member's
 * browser. The database is the real boundary (0020's `entry_out_before_week`
 * carries this exact test in SQL, and the anon key ships in the bundle), and
 * this is the TypeScript spelling of the same rule for every consumer that
 * folds picks after they have been read: `toMember`, `mapPublicSnapshot`,
 * `cellFor` and `viewPickForWeek`. One definition each side, kept in step by
 * the test beside this file.
 *
 * The elimination week ITSELF is not "after" — the losing pick stays on the
 * board, because it is the record of how the entry went out.
 *
 * `eliminatedWeek` null or absent means NOTHING is hidden. That field is
 * optional on `Member`, and a row marked eliminated with no week recorded must
 * draw its history rather than blank the season — the same guard `cellFor` has
 * always carried. The SQL side makes the identical call
 * (`eliminated_week is not null`), so the two cannot disagree on that row.
 *
 * A LEAF: no imports, so `load.ts`, `public.ts`, the standings grid and the
 * admin tab can all reach it without dragging each other in. Same discipline
 * as `entry-key.ts` and `accent.ts`.
 */
export function isAfterElimination(
  entry: { status: "alive" | "eliminated"; eliminatedWeek?: number | null },
  week: number,
): boolean {
  return (
    entry.status === "eliminated" &&
    entry.eliminatedWeek != null &&
    week > entry.eliminatedWeek
  );
}

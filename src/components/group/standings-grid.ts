import type { Game, TeamId } from "../../lib/nfl/types";
import type { GroupRules, Member } from "../../lib/league/types";
import { viewCurrentPick } from "../../lib/league/view";

/**
 * The standings table's pure half: what each cell shows, and where the scroller
 * has to sit for the live week to be on screen.
 *
 * Relative imports, not `@/`. There is no `vitest.config.ts` in this repo, so
 * vitest never reads tsconfig's `paths` — a `@/` VALUE import resolves under
 * Next and throws under the test runner. Type-only `@/` imports survive because
 * esbuild erases them, which is exactly the asymmetry that makes this easy to
 * get wrong. Same rule `team-grid.ts` and `week-strip.ts` already follow.
 *
 * It exists at all because vitest runs in the Node environment here with no
 * jsdom, so nothing renders under test: a pure module is the only shape these
 * rules can be pinned in.
 *
 * The sort's bucket rules are deliberately NOT here. They read the same current
 * week through the same `viewCurrentPick`, so they look like they belong beside
 * `cellFor` — but `rankMembers` needs them and lives in `lib/league/view.ts`,
 * which must not import from `components/`. Putting them here was a genuine
 * import cycle, since this module already imports that one. They live there.
 */

// ── Cells ────────────────────────────────────────────────────────────────────

/**
 * One cell of the grid.
 *
 * `result` is what the tile is TINTED by, and it is not simply the pick's
 * outcome: a win is tinted only in the week being played, while a loss is
 * tinted forever. `cellFor` resolves that distinction so the component can
 * paint what it is handed without re-deriving which week it is in.
 */
export type WeekCell =
  | { kind: "empty" }
  | { kind: "hidden" }
  /**
   * A week that has been and gone with no pick made — counted as a loss by the
   * scorer, and drawn as one.
   *
   * Distinct from `empty`, which is the absence of a pick in a week that is
   * still to come (or was never this member's to play). They used to be the same
   * hollow circle, so the most consequential thing on the board — somebody going
   * out by not picking at all — was the only outcome it did not draw. See
   * `cellFor`.
   */
  | { kind: "missed" }
  | { kind: "team"; teamId: TeamId; result?: "win" | "loss" | "push"; live?: boolean };

/**
 * Derive one member's cell for one week, honoring the current-week privacy lock.
 *
 * Three branches, and the split is load-bearing: `gameForTeam` is consulted ONLY
 * for `week === currentWeek`. The landing page narrows its `games` payload to
 * that single week on the strength of it, so a lookup in the past branch would
 * quietly turn every historical cell into a no-pick slot there while the
 * signed-in app carried on looking correct.
 *
 * Two guards sit in front of those branches, and both exist so that a cell with
 * NO pick in it says which kind of nothing it is — `missed` (counted as a loss)
 * or `empty` (not this member's week). Getting that wrong in either direction is
 * a lie about the most consequential fact on the board, so each is stated
 * rather than left to fall out of the ordering.
 */
export function cellFor(
  member: Member,
  viewerId: string,
  week: number,
  currentWeek: number,
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined,
  rules: GroupRules,
  now: Date,
  hiddenSet: ReadonlySet<string>,
): WeekCell {
  /*
   * AN ELIMINATED ROW STOPS AT THE WEEK IT WENT OUT.
   *
   * Being knocked out does not delete anything: picks made ahead for later
   * weeks stay in the database, and `historyResult` resolves them happily — so
   * without this a dead row kept drawing logos, tints and padlocks for weeks
   * the member was no longer in, as if they were still playing. The scorer
   * agrees: `computeStatus` stops folding at elimination, so those weeks are
   * not counted against them either.
   *
   * `eliminatedWeek != null` is load-bearing. It is optional on `Member`, and a
   * row marked eliminated with no week recorded must fall through and draw its
   * history rather than blank the entire season.
   */
  if (
    member.status === "eliminated" &&
    member.eliminatedWeek != null &&
    week > member.eliminatedWeek
  ) {
    return { kind: "empty" };
  }

  /*
   * A WEEK BEFORE THIS MEMBER'S RECORD BEGINS IS NOT A MISSED PICK.
   *
   * Absent on both real boards, where the record starts at week 1 — see
   * `Member.scoredFromWeek`. The practice table sets it, because preseason has
   * no entry deadline and its weeks before a member's first pick are skipped
   * rather than forgiven; drawing them as missed would charge a new account for
   * the Hall of Fame game in early August.
   */
  const scoredFrom = member.scoredFromWeek === undefined ? 1 : member.scoredFromWeek;
  if (scoredFrom === null || week < scoredFrom) return { kind: "empty" };

  if (week < currentWeek) {
    const h = member.history.find((x) => x.week === week);
    // Past, no pick, and the guards above have ruled out every week that was
    // not theirs to play — so this is a genuine no-pick, which the scorer
    // counts as a loss. Every producer of `history` keeps a past pick whose
    // game never resolved (as `"pending"`) precisely so this stays true: a
    // dropped pick here would print a loss over a pick that was made.
    if (!h) return { kind: "missed" };
    // A settled week keeps its LOSS tint for the rest of the season and drops
    // its win tint. The asymmetry is the design's, and it is the whole reason
    // the table can be scrolled to read who went out and in what order: green
    // on every survived week would be a wall of colour saying nothing, while a
    // red tile is the week somebody took a strike. A push survives, so it reads
    // as a win does — untinted — unless the league counts ties as losses, in
    // which case `history` already carries it as a loss. A `"pending"` pick is
    // untinted for the same reason: it is on the board, its outcome is not
    // known, and nothing about it is a strike yet.
    return { kind: "team", teamId: h.teamId, result: h.result === "loss" ? "loss" : undefined };
  }
  if (week === currentWeek) {
    const pv = viewCurrentPick(member, viewerId, week, gameForTeam, rules, now);
    // RLS hides a rival's un-kicked pick entirely (no row → no currentPick), so
    // fall back to the team-less flag to still show the padlock.
    if (!pv.hasPick) {
      if (hiddenSet.has(member.id)) return { kind: "hidden" };
      /*
       * Eliminated IN this week with nothing in it — they went out by not
       * picking, and this is the cell that says so.
       *
       * It is a real window, not a corner case: `resolveCurrentWeek` holds the
       * current week until the NEXT week's first kickoff, so a member struck out
       * by Monday night reads as eliminated-at-the-current-week from then until
       * Thursday. The past branch takes over afterwards.
       */
      if (member.status === "eliminated" && member.eliminatedWeek === week) {
        return { kind: "missed" };
      }
      return { kind: "empty" };
    }
    if (!pv.revealed) return { kind: "hidden" };
    const result =
      pv.result === "win" || pv.result === "loss" || pv.result === "push" ? pv.result : undefined;
    return { kind: "team", teamId: pv.teamId!, result, live: pv.status === "live" };
  }
  return { kind: "empty" };
}

// ── Horizontal scroll ────────────────────────────────────────────────────────

/**
 * Where to park the scroller so `index`'s column sits just past the sticky name
 * column rather than under it.
 *
 * By week 10 the live week is off the right edge on a phone, and the table
 * opens on a stretch of settled weeks with the one column anybody came to read
 * out of sight. Clamped at 0 so an early week never scrolls backwards into
 * negative territory, which browsers silently floor anyway — stating it makes
 * the intent testable.
 *
 * `index` is the column's position in the rendered list, NOT a week number: the
 * practice table's columns are P1..P3 followed by previewed regular weeks, so
 * week numbers there are neither unique nor ordered.
 */
export function scrollLeftForWeek(index: number, stickyWidth: number, pitch: number): number {
  if (index < 0) return 0;
  return Math.max(0, index * pitch - stickyWidth);
}

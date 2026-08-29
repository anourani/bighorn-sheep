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
  | { kind: "team"; teamId: TeamId; result?: "win" | "loss" | "push"; live?: boolean };

/**
 * Derive one member's cell for one week, honoring the current-week privacy lock.
 *
 * Three branches, and the split is load-bearing: `gameForTeam` is consulted ONLY
 * for `week === currentWeek`. The landing page narrows its `games` payload to
 * that single week on the strength of it, so a lookup in the past branch would
 * quietly turn every historical cell into a no-pick slot there while the
 * signed-in app carried on looking correct.
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
  if (week < currentWeek) {
    const h = member.history.find((x) => x.week === week);
    if (!h) return { kind: "empty" };
    // A settled week keeps its LOSS tint for the rest of the season and drops
    // its win tint. The asymmetry is the design's, and it is the whole reason
    // the table can be scrolled to read who went out and in what order: green
    // on every survived week would be a wall of colour saying nothing, while a
    // red tile is the week somebody took a strike. A push survives, so it reads
    // as a win does — untinted — unless the league counts ties as losses, in
    // which case `history` already carries it as a loss.
    return { kind: "team", teamId: h.teamId, result: h.result === "loss" ? "loss" : undefined };
  }
  if (week === currentWeek) {
    const pv = viewCurrentPick(member, viewerId, week, gameForTeam, rules, now);
    // RLS hides a rival's un-kicked pick entirely (no row → no currentPick), so
    // fall back to the team-less flag to still show the padlock.
    if (!pv.hasPick) return hiddenSet.has(member.id) ? { kind: "hidden" } : { kind: "empty" };
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

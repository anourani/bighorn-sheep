import { evaluateTeamPick } from "../../lib/game/elimination";
import type { WeekOption, WeekRef } from "../../lib/nfl/calendar";
import type { Game, TeamId } from "../../lib/nfl/types";
import type { GroupRules } from "../../lib/league/types";

/**
 * The arithmetic and the chip model behind `WeekStrip`, kept out of the
 * component so they unit-test without a component-test stack — the same split
 * `shell/nav.ts` and `team-grid.ts` make, and the repo's standing convention
 * (vitest runs in the Node environment; there is no jsdom and no
 * @testing-library here).
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Where the scroller must sit for `item` to be on screen, clamped to the range
 * `scrollLeft` actually accepts.
 *
 * Computed rather than delegated to `element.scrollIntoView()` because that
 * walks *every* scrollable ancestor: with the strip near the top of a long page
 * it will also scroll the document to bring the chip into view, so selecting a
 * week jogs the page vertically. Writing `scrollLeft` on the one container we
 * mean cannot do that, under any condition.
 *
 * Two alignments, because the two moments want different things:
 *
 * - `center` for arriving — the selected week should look deliberately placed,
 *   with the weeks either side of it visible.
 * - `nearest` for moving, which returns the current `scrollLeft` untouched when
 *   the chip is already fully visible. Centring on every tap would slide the
 *   strip out from under the finger that just tapped it; this only moves when
 *   the chip is actually cut off.
 *
 * The clamp is what makes the ends behave: the first and last chips cannot be
 * centred — there is no content past the edge to fill the other half — so they
 * settle flush instead, which is also what stops a smooth scroll from visibly
 * over-travelling and springing back.
 */
export function scrollLeftFor({
  scrollLeft,
  viewWidth,
  contentWidth,
  itemStart,
  itemWidth,
  align,
}: {
  /** The scroller's current `scrollLeft`. */
  scrollLeft: number;
  /** The scroller's visible width (`clientWidth`). */
  viewWidth: number;
  /** The full scrollable width (`scrollWidth`). */
  contentWidth: number;
  /** The item's start within the scrolled content, in the same axis as `scrollLeft`. */
  itemStart: number;
  itemWidth: number;
  align: "center" | "nearest";
}): number {
  const max = Math.max(0, contentWidth - viewWidth);

  if (align === "center") {
    return Math.round(clamp(itemStart + itemWidth / 2 - viewWidth / 2, 0, max));
  }

  if (itemStart < scrollLeft) return Math.round(clamp(itemStart, 0, max));
  const itemEnd = itemStart + itemWidth;
  if (itemEnd > scrollLeft + viewWidth) return Math.round(clamp(itemEnd - viewWidth, 0, max));
  return Math.round(clamp(scrollLeft, 0, max));
}

/**
 * Roving-tabindex keyboard movement for the chip row.
 *
 * Returns the index to move to, or null when the key isn't ours — which is the
 * signal not to `preventDefault`, so Tab, Enter and everything else keep their
 * normal behaviour. Up and Down are deliberately not ours: the page still has to
 * scroll with the strip focused.
 *
 * Movement clamps at the ends rather than wrapping. Wrapping is allowed for a
 * tablist, but the strip is an ordered axis with a scroll position attached:
 * arrowing left off Week 1 to land on Week 18 would fling the scroller the whole
 * way across, which reads as a glitch rather than as navigation.
 */
export function nextIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  // A `current` outside the list (nothing selected yet, or the selection dropped
  // out from under us) starts from the top rather than throwing the maths off.
  const from = current >= 0 && current < length ? current : 0;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, from - 1);
    case "ArrowRight":
      return Math.min(length - 1, from + 1);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

/**
 * What a chip's corner numeral reports about the week it names.
 *
 * Three inks, not four: `push` folds into `win` because the admin's tie rule has
 * already been applied by the time we get here — `evaluateTeamPick` returns
 * "loss" outright in a league that counts a tie against you, and "push" only in
 * one where it doesn't. A push is therefore always a week you got through, which
 * is the question the colour answers. (Note `StandingsGrid` gives a push its own
 * blue wash, so the two surfaces describe a tie differently on purpose; a fourth
 * ink here would be a spec change, not a fix.)
 */
export type ChipOutcome = "undecided" | "win" | "loss";

/** What a chip draws inside itself: the team spent that week, and how it went. */
export interface ChipPick {
  teamId: TeamId;
  outcome: ChipOutcome;
}

export interface ChipPicksInput {
  options: readonly WeekOption[];
  /**
   * The team picked for a week — server truth and the optimistic overlay already
   * merged. Null means no pick, and the week gets no map entry at all.
   */
  pickFor: (ref: WeekRef) => TeamId | null;
  /**
   * That team's game in that week, PHASE-CORRECT. Null for a bye, or for a
   * schedule that isn't loaded — both of which must read `undecided`, never
   * `loss`.
   *
   * Injected as an accessor rather than taking a `GameIndex`, the same shape
   * `orderGridTeams` and `viewCurrentPick` use: it keeps this module testable
   * with two closures and no fixture building. It also puts the phase routing at
   * the call site, which is where the two indexes live — a preseason week 3 is
   * not a regular week 3, and one index over both would silently answer with
   * whichever row arrived first.
   */
  gameFor: (ref: WeekRef, teamId: TeamId) => Game | null;
  rules: GroupRules;
}

/**
 * The strip's per-week model, keyed by `weekKey`.
 *
 * The outcome is DERIVED from the schedule the client already holds rather than
 * read off `Member.history`, which structurally cannot answer three of the four
 * cases the strip has to draw:
 *
 * - The current week is absent from `history` by construction — `toMember` in
 *   league/load.ts routes `week === currentWeek` into `currentPick` and only
 *   earlier weeks into `history`. A history-driven chip would stay grey through
 *   Monday night even after the game had gone final.
 * - Preseason isn't in `history` at all, and `history` is keyed by a bare week
 *   number, so `pre:3` and `regular:3` would collide.
 * - An optimistic pick has no history entry; painting it before the server
 *   answers is the whole point of `pendingPicks`.
 *
 * This is not a second implementation of the rules: `historyResult` in load.ts
 * falls back to this same `evaluateTeamPick` whenever a stored result is absent.
 * What it gives up is a hand-corrected `picks.result` that disagrees with the
 * `games` rows — which is accepted, since both come from the same table.
 */
export function buildChipPicks(input: ChipPicksInput): Map<string, ChipPick> {
  const { options, pickFor, gameFor, rules } = input;
  const byWeek = new Map<string, ChipPick>();

  for (const option of options) {
    const teamId = pickFor(option.ref);
    if (!teamId) continue; // absent key means "no pick" — the contract Chip branches on

    // evaluateTeamPick answers "pending" for a null game, so a bye, an unloaded
    // schedule and a week that hasn't been played all fall through to
    // `undecided` without a special case here.
    const result = evaluateTeamPick(gameFor(option.ref, teamId), teamId, rules);
    const outcome: ChipOutcome =
      result === "win" || result === "push" ? "win" : result === "loss" ? "loss" : "undecided";

    byWeek.set(option.key, { teamId, outcome });
  }

  return byWeek;
}

/**
 * The chip's accessible name. The chip prints "04", which on its own names
 * nothing — so the numeral is hidden and this is supplied instead.
 *
 * The outcome is spoken because after the redesign it is carried by COLOUR
 * ALONE: green versus red ink, same numeral, same place, same size. That is a
 * WCAG 1.4.1 failure without this line, and it is the argument `cardAriaLabel`
 * already makes for the grid's greyscale logos.
 *
 * Nothing is said for `undecided`, which would put a filler word on most of
 * eighteen chips. "current week" stays last: a Monday-night current week can
 * legitimately carry a decided outcome, so the order needs to be fixed rather
 * than incidental.
 */
export function chipName(
  option: WeekOption,
  teamName: string | null,
  outcome?: ChipOutcome,
): string {
  const parts = [option.label];
  if (teamName) parts.push(`picked ${teamName}`);
  if (outcome === "win") parts.push("won");
  else if (outcome === "loss") parts.push("lost");
  if (option.isCurrent) parts.push("current week");
  return parts.join(", ");
}

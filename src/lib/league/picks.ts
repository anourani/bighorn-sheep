import { PRE_WEEK, REGULAR_WEEK, weekKey, type WeekRef } from "../nfl/calendar";
import type { TeamId } from "../nfl/types";

/**
 * The viewer's own picks along the week axis.
 *
 * The pick screen has two different weeks in play at once: the week you have
 * SELECTED in the week strip, and the week that is LIVE. The pick module used to
 * be wired to the live week while the schedule below it followed the selection,
 * so switching weeks left it showing a team from a week that was no longer on
 * screen — and re-derived its opponent and kickoff from the live week's fixture,
 * rendering a game the member never picked.
 *
 * Fixing that needs a pick per week rather than a pick per phase, which is what
 * this module is. Pure, so it unit-tests without a component-test stack.
 *
 * Every week that has not kicked off is now writable, so "the week you may pick
 * for" is no longer one number and the live week's only remaining job here is to
 * mark the floor: `resolvePickWeek` in game/season.ts refuses anything below it.
 */

/** Keyed by `weekKey(ref)` — "pre:1", "regular:1". */
export type PicksByWeek = ReadonlyMap<string, TeamId>;

/**
 * The in-flight overlay. An explicit `null` means "this tab believes there is no
 * pick here", which is not the same as an absent key ("no opinion, ask the
 * server") — a rejected pick reverts by writing that null.
 */
export type PendingPicks = ReadonlyMap<string, TeamId | null>;

export interface ViewerPickSources {
  /**
   * EVERY regular-season pick, any week, resolved or not
   * (`LeagueData.viewerPicks`).
   *
   * This replaced a `history` + `currentPick` pair, which could not answer the
   * question between them: `Member.history` carries only picks whose game has
   * produced a RESULT and only weeks before the current one, and `currentPick`
   * is one week by construction — so a pick made for a week ahead appeared in
   * neither, and an unresolved past pick appeared in neither either. One source
   * per phase, and no precedence rule to get wrong.
   */
  regularPicks?: readonly { week: number; teamId: TeamId }[];
  /**
   * EVERY preseason pick, resolved or not (`PracticeMember.picks`). Same
   * contract as `regularPicks` above; practice has always been shaped this way,
   * because with no scorer running nothing resolves and a result-gated list
   * would be permanently empty.
   */
  practicePicks?: readonly { week: number; teamId: TeamId }[];
}

/**
 * Index the viewer's picks by week across both phases.
 *
 * Keyed by `weekKey`, never by a bare week number: preseason week 1 and opening
 * Sunday are different picks in different games, and a number-keyed map merges
 * them silently. Same collision that already forces two `buildGameIndex`es on
 * the picks screen.
 */
export function viewerPicksByWeek(src: ViewerPickSources): Map<string, TeamId> {
  const out = new Map<string, TeamId>();
  for (const p of src.regularPicks ?? []) out.set(weekKey(REGULAR_WEEK(p.week)), p.teamId);
  for (const p of src.practicePicks ?? []) out.set(weekKey(PRE_WEEK(p.week)), p.teamId);
  return out;
}

/**
 * The OTHER week this team is already committed to, if any.
 *
 * A team may be spent once per phase (`picks_team_once_per_phase`), so picking
 * one that is already booked elsewhere has to do something about the other week.
 * The rule is that the week you tap wins: the earlier commitment is released and
 * a toast names it. This answers "which week is about to lose its pick", for the
 * copy and for the optimistic overlay that clears its chip.
 *
 * Whether that release is ALLOWED is a separate question and not this function's
 * — a team whose game has already kicked off is genuinely spent, and both the
 * caller and `submitPick` test kickoff themselves. Returning the week either way
 * keeps this a lookup rather than a second, drifting copy of the lock rule.
 *
 * `picks` is one phase's list; `targetWeek` is excluded because replacing your
 * own pick for the week on screen is not a release.
 */
export function committedWeek(
  picks: readonly { week: number; teamId: TeamId }[],
  teamId: TeamId,
  targetWeek: number,
): number | null {
  const found = picks.find((p) => p.teamId === teamId && p.week !== targetWeek);
  return found ? found.week : null;
}

/**
 * The team picked for `ref`: this tab's in-flight value if it holds one for that
 * exact week, else server truth.
 *
 * Because the overlay is keyed by week, an optimistic pick can never be painted
 * under a different week's label — which is what happened when the pick lived in
 * a single scalar and the live week advanced with the tab open.
 */
export function pickForWeek(ref: WeekRef, server: PicksByWeek, pending: PendingPicks): TeamId | null {
  const key = weekKey(ref);
  // `has`, not `??` — reverting a rejected pick writes an explicit null, and
  // that has to beat a server map which has not been re-fetched.
  if (pending.has(key)) return pending.get(key) ?? null;
  return server.get(key) ?? null;
}

/**
 * Drop the overlay entries the server has caught up with, keeping the rest.
 *
 * The overlay exists to cover the gap between the tap and the refreshed props,
 * and without this nothing ever cleared it — an entry outlived the write that
 * justified it and shadowed the server for the life of the mounted screen, so a
 * pick changed from another tab or device could never appear. Pruning on
 * AGREEMENT rather than on write-success is what makes it safe: an entry whose
 * write is still in flight disagrees with the prop it has not landed in yet, so
 * it survives and the selection never flickers back.
 *
 * An explicit overlay null against a server map with no entry counts as
 * agreement, matching pickForWeek's `?? null`. Returns the SAME map when
 * nothing changed, so the caller's `setState` bails out instead of re-rendering
 * on every refresh.
 */
export function pruneAgreedPicks(pending: PendingPicks, server: PicksByWeek): PendingPicks {
  if (pending.size === 0) return pending;

  const next = new Map<string, TeamId | null>();
  for (const [key, team] of pending) {
    if ((server.get(key) ?? null) !== team) next.set(key, team);
  }
  return next.size === pending.size ? pending : next;
}

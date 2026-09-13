import type { Member } from "../../lib/league/types";

/**
 * Whether the pick surfaces may be WRITTEN to — the one gate the screen has to
 * agree with `canPick` about.
 *
 * Relative imports, not `@/`: there is no `vitest.config.ts` in this repo, so
 * vitest never reads tsconfig's `paths`. This is a type-only import and would
 * survive either way, but the rule is the file's, not the import's — see the
 * note at the top of `standings-grid.ts`.
 *
 * A pure module because vitest runs in the Node environment here with no jsdom,
 * so nothing renders under test. Same split as `pick-queue.ts` and
 * `team-grid.ts`.
 */

export interface WritabilityInput {
  /** The week on screen is the live one. */
  isCurrent: boolean;
  /** The week on screen is later than the live one — pre-filling is allowed. */
  viewingFuture: boolean;
  /** The status of the ENTRY being played, not of the person playing it. */
  entryStatus: Member["status"];
  /**
   * The entry's EXISTING pick for the week on screen has kicked off.
   *
   * Read off server truth rather than the optimistic overlay: an overlay entry
   * is by definition a pick whose game has not started, so reading it would let
   * an in-flight value unlock a week the server still holds locked.
   */
  pickLocked: boolean;
}

/**
 * Three independent gates, and all of them have to open.
 *
 * THE WEEK: the live week and everything after it. Stated as a positive rather
 * than as `!viewingPast`, even though the two are identical today —
 * `viewingPast` leans on an invariant (the two week refs share a `seasonType`)
 * that holds because of `MyPicksClient`'s sanitising, and if that ever slipped a
 * negation would fail OPEN and quietly make an unrelated week writable, where
 * this fails closed.
 *
 * THE ENTRY: an eliminated entry can never write again. `canPick` refuses it
 * outright (`reason: "eliminated"`) and so does `submitPick` — but the screen
 * did not read status at all, so a knocked-out player got a fully live grid,
 * tapped, watched the pick paint, and watched it snap back a moment later under
 * an error line. The grid has to agree with the guard, or it is offering
 * something the server will refuse.
 *
 * THE PICK: once your pick for this week has kicked off, you are committed, and
 * the WHOLE week closes — not just the card you picked. The per-card kickoff
 * test below cannot express this: a Thursday-night pick locks while the Sunday
 * games are still hours away, so every other card in that week stayed in colour
 * with an enabled radio and invited a tap that rewrote a pick already in play.
 * The database refused it all along — RLS `"picks update own before kickoff"`
 * gates the EXISTING row's game — but a failing `using` clause FILTERS a row on
 * UPDATE rather than raising, so the write matched nothing, reported no error,
 * and the screen said it had saved. This gate is what stops the offer being made.
 *
 * Per-game locks stay the surface's own job — `buildGridCards` refuses a card
 * whose own kickoff has passed, which is what closes the started game's two
 * teams in a week you have NOT picked yet. So this is a week-entry-and-pick
 * gate; the card gate remains beneath it.
 */
export function isEntryWritable(input: WritabilityInput): boolean {
  if (input.entryStatus === "eliminated") return false;
  if (input.pickLocked) return false;
  return input.isCurrent || input.viewingFuture;
}

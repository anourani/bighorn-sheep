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
}

/**
 * Two independent gates, and both have to open.
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
 * Per-game locks stay the surface's own job — `buildGridCards` refuses a card
 * whose kickoff has passed — so this is a week-and-entry gate, not a pick gate.
 */
export function isEntryWritable(input: WritabilityInput): boolean {
  if (input.entryStatus === "eliminated") return false;
  return input.isCurrent || input.viewingFuture;
}

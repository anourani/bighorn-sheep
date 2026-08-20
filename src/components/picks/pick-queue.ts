import type { TeamId } from "../../lib/nfl/teams";

/**
 * The submit chain behind the pick surfaces — single-flight with a trailing tap.
 *
 * The grid stays interactive while a pick saves, so taps can arrive faster than
 * the server answers. Sending them all concurrently would race on one picks row
 * (two upserts can land out of order, leaving the database holding a team the
 * screen no longer shows), and a late failure's revert would clobber a newer
 * tap's optimistic value with a stale team. So: at most one submitPick in flight
 * per week, and a tap made during flight only replaces the LATEST desired team —
 * when the in-flight request settles, the newest tap alone is sent.
 *
 * It lives apart from `MyPicksClient.tsx` because vitest runs in the Node
 * environment here; there is no jsdom and no @testing-library, so a pure module
 * is the only testable shape. Same split as `team-grid.ts` and `week-strip.ts`.
 * The component owns the side effects — the overlay write, the error line, the
 * submitPick call itself; this module only answers "what happens next".
 */

export interface PickQueue {
  /** The team whose submitPick is currently awaited. Null when idle. */
  inFlight: TeamId | null;
  /** The newest tap made during flight — earlier ones are never sent. */
  queued: TeamId | null;
  /**
   * The last value the server is known to hold for this week. Reverts target
   * this, NOT the value at chain start: if pick A succeeded and pick B then
   * failed, the honest screen shows A.
   */
  confirmed: TeamId | null;
}

export const IDLE_QUEUE: PickQueue = { inFlight: null, queued: null, confirmed: null };

export interface TapOutcome {
  state: PickQueue;
  /** The team to submit now — null when a request is already in flight. */
  submit: TeamId | null;
}

/**
 * A tap on `team`. `serverValue` is what this tab believes the server holds,
 * read only when the chain is idle, to seed the revert baseline. Mid-chain it
 * is ignored: the value on screen by then is the optimistic overlay, which is
 * exactly what a revert must not target — the chain carries its own baseline.
 */
export function tapPick(
  state: PickQueue,
  team: TeamId,
  serverValue: TeamId | null,
): TapOutcome {
  if (state.inFlight !== null) {
    return { state: { ...state, queued: team }, submit: null };
  }
  return { state: { inFlight: team, queued: null, confirmed: serverValue }, submit: team };
}

export interface SettleOutcome {
  state: PickQueue;
  /** The queued tap, released for sending. */
  submit: TeamId | null;
  /**
   * Overlay write-back. Distinct from "no write": `to` can be an explicit
   * null, which pickForWeek honours over a server map that has not been
   * re-fetched.
   */
  revert: { to: TeamId | null } | null;
  surfaceError: boolean;
}

/**
 * The in-flight submitPick answered.
 *
 * A failure with a queued tap behind it is SILENT — the user no longer wants
 * the failed team, so there is nothing to revert to or apologise for. A refusal
 * that applies to any team (eliminated, entry closed) fails the queued submit
 * identically and surfaces there, one settle later; nothing is lost.
 */
export function settlePick(state: PickQueue, ok: boolean): SettleOutcome {
  const confirmed = ok ? state.inFlight : state.confirmed;
  const superseded = state.queued !== null;

  if (state.queued !== null && state.queued !== confirmed) {
    return {
      state: { inFlight: state.queued, queued: null, confirmed },
      submit: state.queued,
      revert: null,
      surfaceError: false,
    };
  }

  return {
    state: { inFlight: null, queued: null, confirmed },
    submit: null,
    // The screen may be showing a team the server refused; put the confirmed
    // value back. When the latest tap merely returned to the confirmed team,
    // this writes what the overlay already shows — harmless, and it keeps the
    // rule simple: a chain that ends without sending always ends on `confirmed`.
    revert: ok ? null : { to: confirmed },
    surfaceError: !ok && !superseded,
  };
}

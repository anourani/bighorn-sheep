import type { Game } from "@/lib/nfl/types";

/**
 * The matchup card's clock slot: what a game says about itself where a scheduled
 * game says "4:00 PM EST".
 *
 * This is a whole module for one string because the feed's format is NOT KNOWN
 * from inside this repo, and the two sources that look authoritative disagree:
 *
 *   - `nfl/types.ts` documents `statusDetail` as "3rd 04:21", and both
 *     `mock/data.ts` and `scripts/sim-advance.ts` write that shape — PERIOD first.
 *   - It is actually fed from ESPN's `competition.status.type.shortDetail`
 *     (`providers/espn.ts`), which is CLOCK first: "4:31 - 2nd".
 *
 * There is no `espn.test.ts` and no captured ESPN payload anywhere in the repo,
 * so nothing here has ever been checked against the real thing. A parser written
 * against the mocks alone would look perfect in dev and mis-render every live
 * game in production — the failure would be a wrong-looking string on the one
 * screen everybody watches on a Sunday, with nothing thrown and no test red.
 *
 * So: accept BOTH shapes, and when neither matches, hand back the feed's own
 * words rather than guessing or blanking. The worst case is that a reader sees
 * ESPN's phrasing instead of ours; there is no case where the slot goes empty or
 * prints something that isn't about this game.
 */

/** Clock first — ESPN's real shape. "4:31 - 2nd", "0:12 - OT". */
const CLOCK_FIRST = /^(\d{1,2}:\d{2})\s*-\s*(.+)$/;

/** Period first — what this repo's own fixtures write. "2nd 05:12". */
const PERIOD_FIRST = /^(\S+)\s+(\d{1,2}:\d{2})$/;

/** "1st" / "2ND" / "3rd" / "4th", and the bare "1".."4" some feeds use. */
const ORDINAL = /^([1-9])(?:st|nd|rd|th)?$/i;

/** "OT", "2OT", "3ot" — overtime keeps its own name rather than becoming "5Q". */
const OVERTIME = /^(\d*)OT$/i;

/**
 * A period as the design writes it: "2Q", "OT", "2OT". Null when the token is
 * not a period at all, which is how "Halftime" and "End of 1st" fall through to
 * being passed along verbatim.
 */
function periodAbbr(raw: string): string | null {
  const token = raw.trim();

  const overtime = OVERTIME.exec(token);
  if (overtime) return `${overtime[1] ?? ""}OT`;

  const ordinal = ORDINAL.exec(token);
  if (ordinal?.[1]) return `${ordinal[1]}Q`;

  return null;
}

/**
 * "05:12" -> "5:12". The design writes "4:31", and ESPN's live clock is already
 * unpadded — but this repo's fixtures pad it, so both arrive here.
 */
function trimClock(clock: string): string {
  return clock.replace(/^0(\d:)/, "$1");
}

/**
 * "2Q 4:31" from whichever way round the feed wrote it, or null.
 *
 * The two shapes are tried in turn rather than merged into one alternation,
 * because a match is only good if its PERIOD half also parses — "9/7 - 1:00 PM
 * EDT" satisfies the clock-first pattern and must still fall through.
 */
function livePeriodClock(detail: string): string | null {
  for (const [pattern, clockAt, periodAt] of [
    [CLOCK_FIRST, 1, 2],
    [PERIOD_FIRST, 2, 1],
  ] as const) {
    const match = pattern.exec(detail);
    if (!match) continue;

    const clock = match[clockAt];
    const period = match[periodAt];
    if (clock === undefined || period === undefined) continue;

    const abbr = periodAbbr(period);
    if (abbr) return `${abbr} ${trimClock(clock)}`;
  }

  return null;
}

/**
 * The clock-slot line for a game — "2Q 4:31", "Halftime", "Final/OT" — or null
 * to fall back to the kickoff time.
 *
 * Takes the whole game rather than the string alone because `status` is what
 * makes the string safe to read: a SCHEDULED game's `statusDetail` is a
 * formatted DATE ("9/7 - 1:00 PM EDT"), it is persisted by `gameToRow`, and it
 * matches `CLOCK_FIRST` on its way past. Reading `statusDetail` without checking
 * `status` first would put a date in the clock slot of every unplayed game.
 */
export function gameClockLabel(game: Pick<Game, "status" | "statusDetail">): string | null {
  const detail = game.statusDetail?.trim();

  if (game.status === "final") {
    // "Final" and "Final/OT" both already read correctly; anything else the feed
    // calls final does not, so it is replaced rather than trusted.
    return detail && /^final/i.test(detail) ? detail : "Final";
  }

  if (game.status !== "in_progress") {
    // `delayed` and `postponed` land here too. Their detail is a bare word with
    // no clock in it, and the kickoff time is the more useful thing to show
    // beside the "Locked" the header prints anyway.
    return null;
  }

  if (!detail) return null;

  // "Halftime" and "End of 1st" carry no clock and match neither shape, which is
  // exactly why the fallthrough is the raw string and not null.
  return livePeriodClock(detail) ?? detail;
}

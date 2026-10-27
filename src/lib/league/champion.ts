/**
 * Who won the league, and in which week — derived, never stored.
 *
 * Every entry "lasted until" some week: an alive entry lasted forever, an
 * eliminated one until its `eliminatedWeek`. The CHAMPION is the one entry that
 * lasted strictly longer than every other; the WINNING WEEK is the runner-up's
 * number — the week the last rival went out, which the champion survived and
 * nobody else did.
 *
 * Reading the runner-up rather than the champion is what keeps this true after
 * the champion carries on playing. Nothing stops a winner picking on, and a
 * later loss marks them eliminated like anyone else (the scorer has no notion of
 * a winner) — but they still lasted longest, and the week they won in is still
 * the week the field emptied behind them.
 *
 * Null whenever there is no single winner, and each case is deliberate:
 *  - two or more still alive — the season is still being played;
 *  - a tie at the top — a wipeout, where the last entries went out together;
 *  - fewer than two entries — a one-entry league has nobody to outlast;
 *  - an eliminated row with no week recorded — the order is unknown, and a
 *    guessed champion is a false claim drawn in the league's most visible colour.
 *
 * The practice table forces every row `alive`, so it can never produce one.
 *
 * A LEAF: type-only imports, so it is safe under vitest's missing `paths` and
 * costs the landing page's client bundle nothing it doesn't already carry.
 */
import type { Member } from "./types";

export interface Champion {
  /** The winning entry's MEMBERSHIP id (`member.id`), not the person's. */
  memberId: string;
  /** The week the league was won in. */
  week: number;
}

export function championOf(
  members: readonly Pick<Member, "id" | "status" | "eliminatedWeek">[],
): Champion | null {
  if (members.length < 2) return null;

  const lasted: { id: string; until: number }[] = [];
  for (const m of members) {
    if (m.status === "alive") {
      lasted.push({ id: m.id, until: Infinity });
    } else if (typeof m.eliminatedWeek === "number") {
      lasted.push({ id: m.id, until: m.eliminatedWeek });
    } else {
      return null;
    }
  }

  lasted.sort((a, b) => b.until - a.until);
  const [first, second] = lasted as [(typeof lasted)[number], (typeof lasted)[number]];
  // `second` finite rules out two survivors; strictly greater rules out a tie.
  if (!Number.isFinite(second.until) || first.until <= second.until) return null;
  return { memberId: first.id, week: second.until };
}

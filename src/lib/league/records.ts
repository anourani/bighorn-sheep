import { gameWinner, type Game, type TeamId } from "../nfl/types";
import type { TeamRecord } from "./types";

/**
 * Team win-loss records, folded out of the schedule the client already holds.
 *
 * Nothing in the database carries a team's record: the `games` table has no
 * standings columns, and neither `load-schedule` nor `poll-scores` writes any.
 * But `LeagueData.games` ships every regular-season game for all 18 weeks with
 * its status and score, so the record is derivable here — no round-trip, no
 * migration, and no second source of truth to drift.
 *
 * Consequence worth knowing: a record is only as current as the scorer. Until a
 * regular-season game is actually marked final in Postgres, every team reads
 * 0-0.
 */

/** Zero record, for a team that hasn't been counted (or hasn't played). */
export function emptyRecord(): TeamRecord {
  return { w: 0, l: 0, t: 0 };
}

/**
 * Records from every completed regular-season game *before* `week`.
 *
 * Strictly before, not up to and including: the badge then means "record coming
 * into this week", which is stable for the whole week you are picking in. Counting
 * the current week instead would have the number shift under the reader between
 * Thursday night and Monday night, mid-decision.
 *
 * Preseason is excluded outright — practice results are not season results, and
 * `seasonType` is checked here rather than trusted from the caller so this stays
 * correct if it is ever handed the unfiltered schedule.
 */
export function recordsThroughWeek(
  games: readonly Game[],
  week: number,
): Map<TeamId, TeamRecord> {
  const out = new Map<TeamId, TeamRecord>();
  const bump = (id: TeamId, field: keyof TeamRecord) => {
    const current = out.get(id) ?? emptyRecord();
    current[field] += 1;
    out.set(id, current);
  };

  for (const game of games) {
    if (game.seasonType !== "regular") continue;
    if (game.week >= week) continue;
    // null for anything not final, and for a final with a missing score.
    const winner = gameWinner(game);
    if (winner === null) continue;
    if (winner === "tie") {
      bump(game.home, "t");
      bump(game.away, "t");
      continue;
    }
    bump(winner, "w");
    bump(winner === game.home ? game.away : game.home, "l");
  }

  return out;
}

/**
 * "9-4", or "9-4-1" once there is a tie. Ties are dropped when there are none
 * so the common case stays four characters wide in a 154px card.
 */
export function formatRecord(record: TeamRecord | undefined): string {
  const r = record ?? { w: 0, l: 0, t: 0 };
  return r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

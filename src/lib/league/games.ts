import type { Game, TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";

/**
 * Pure lookups over a flat list of games. Deliberately free of any server or
 * mock import so it can run on both sides of the RSC boundary: the loader builds
 * it server-side to map rows, and the client screens rebuild it from the
 * serialized `games` array (functions can't be passed as props). This is the
 * real-data replacement for the mock's `gameForTeam` / `weekFinalKickoff` /
 * `BYES_BY_WEEK` helpers.
 */
export interface GameIndex {
  all: Game[];
  /** The game a team plays in a given week (undefined on a bye / no schedule). */
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined;
  gameById: (id: string) => Game | undefined;
  /** Last kickoff of a week — the true final pick deadline (null if no games). */
  weekFinalKickoff: (week: number) => Date | null;
  /** Teams NOT playing in a week that DOES have a schedule ([] when unreleased). */
  byesForWeek: (week: number) => TeamId[];
  /** Weeks that have at least one game, ascending. */
  weeksWithGames: number[];
}

const ALL_TEAM_IDS: TeamId[] = TEAMS.map((t) => t.id);

export function buildGameIndex(games: Game[]): GameIndex {
  const byWeek = new Map<number, Game[]>();
  const byId = new Map<string, Game>();
  for (const g of games) {
    byId.set(g.id, g);
    const arr = byWeek.get(g.week) ?? [];
    arr.push(g);
    byWeek.set(g.week, arr);
  }

  const weeksWithGames = [...byWeek.keys()].sort((a, b) => a - b);

  return {
    all: games,
    gameById: (id) => byId.get(id),
    gameForTeam: (week, teamId) =>
      (byWeek.get(week) ?? []).find((g) => g.home === teamId || g.away === teamId),
    weekFinalKickoff: (week) => {
      const wk = byWeek.get(week);
      if (!wk || wk.length === 0) return null;
      return wk.reduce((latest, g) => {
        const k = new Date(g.kickoff);
        return k > latest ? k : latest;
      }, new Date(0));
    },
    byesForWeek: (week) => {
      const wk = byWeek.get(week);
      if (!wk || wk.length === 0) return []; // schedule not released — no bye info
      const playing = new Set<TeamId>();
      for (const g of wk) {
        playing.add(g.home);
        playing.add(g.away);
      }
      return ALL_TEAM_IDS.filter((id) => !playing.has(id));
    },
    weeksWithGames,
  };
}

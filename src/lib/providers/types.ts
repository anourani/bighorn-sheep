import type { Game, SeasonType } from "../nfl/types";

export interface WeekQuery {
  /** Calendar year the season starts in, e.g. 2025. */
  season: number;
  /** 1–18 for the regular season. */
  week: number;
  /** Defaults to "regular". */
  seasonType?: SeasonType;
}

/**
 * The single seam between the app and any live NFL data source.
 *
 * PRD requirement: "wrap the provider behind one internal interface
 * (e.g. getWeekGames() → {kickoff, status, homeScore, awayScore}) so switching
 * providers is a one-file change." ESPN is the v1 implementation; a paid feed
 * (API-Sports / BallDontLie) would just be another class implementing this.
 */
export interface NflProvider {
  readonly name: string;
  /** Every game for the requested week, normalized to the domain `Game`. */
  getWeekGames(query: WeekQuery): Promise<Game[]>;
}

export function seasonTypeToEspn(t: SeasonType | undefined): 1 | 2 | 3 {
  switch (t) {
    case "pre":
      return 1;
    case "post":
      return 3;
    case "regular":
    default:
      return 2;
  }
}

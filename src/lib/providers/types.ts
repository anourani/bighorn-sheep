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

/**
 * Inverse of `seasonTypeToEspn`, for reading the season type an event reports
 * about itself rather than assuming it matches what we asked for.
 *
 * This matters for the bulk schedule load: the scoreboard endpoint is
 * undocumented and does not always honour `seasontype`. Trusting the query would
 * then file regular-season games as preseason, which is precisely the mislabelling
 * the season_type column exists to prevent. Returns null for anything unexpected
 * so the caller can fall back to the query rather than invent a value.
 */
export function espnToSeasonType(n: number | undefined): SeasonType | null {
  switch (n) {
    case 1:
      return "pre";
    case 2:
      return "regular";
    case 3:
      return "post";
    default:
      return null;
  }
}

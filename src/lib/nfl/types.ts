/**
 * Core NFL domain types. Kept provider-agnostic: the ESPN adapter (or any
 * future paid feed) normalizes into these shapes so the rest of the app never
 * sees a vendor-specific field.
 */

export type Conference = "AFC" | "NFC";

export type Division = "East" | "North" | "South" | "West";

/** Stable, lowercase team identifier (e.g. "kc", "phi"). */
export type TeamId = string;

export interface Team {
  id: TeamId;
  /** Short display code, e.g. "KC". */
  abbr: string;
  /** City / region, e.g. "Kansas City". */
  location: string;
  /** Nickname, e.g. "Chiefs". */
  name: string;
  conference: Conference;
  division: Division;
  /** Primary brand color (hex) — an accent dot, and the My Picks strips. */
  color: string;
}

/**
 * Normalized game status. ESPN exposes richer state names; the adapter maps
 * them onto this small closed set the engine and UI understand.
 */
export type GameStatus =
  | "scheduled"
  | "in_progress"
  | "delayed"
  | "final"
  | "postponed";

export type SeasonType = "pre" | "regular" | "post";

export interface Game {
  /** Provider game id (opaque). */
  id: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  /** ISO-8601 UTC kickoff. This is the single source of truth for pick locks. */
  kickoff: string;
  status: GameStatus;
  home: TeamId;
  away: TeamId;
  /** Null until the game has produced a score. */
  homeScore: number | null;
  awayScore: number | null;
  /** Free-text detail from the feed, e.g. "Final/OT", "3rd 04:21". */
  statusDetail?: string;
}

/** Outcome for a single team in a single game. */
export type TeamOutcome = "win" | "loss" | "tie";

export function isKickedOff(game: Pick<Game, "status" | "kickoff">, now: Date): boolean {
  if (game.status === "in_progress" || game.status === "final" || game.status === "delayed") {
    return true;
  }
  // A "scheduled" game whose kickoff time has passed is treated as locked too,
  // guarding against a stale feed that hasn't flipped to in_progress yet.
  return new Date(game.kickoff).getTime() <= now.getTime();
}

/** Which team (if any) won a game. Returns null while the game is unresolved. */
export function gameWinner(game: Game): TeamId | "tie" | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) {
    return null;
  }
  if (game.homeScore > game.awayScore) return game.home;
  if (game.awayScore > game.homeScore) return game.away;
  return "tie";
}

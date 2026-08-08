import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { NflProvider } from "../providers/types";
import { getTeam } from "./teams";
import type { Game, SeasonType } from "./types";

/**
 * Bulk schedule loading, shared by the on-demand loader function and the
 * scheduled scorer.
 *
 * The app has always had a provider that fetches ONE week (`getWeekGames`), and
 * nothing that fetched a season. That is why the games table stayed empty except
 * for whatever `NFL_WEEK` happened to point at, and why every week in the picks
 * dropdown rendered "Schedule not yet released".
 */

type DB = SupabaseClient<Database>;
type GameInsert = Database["public"]["Tables"]["games"]["Insert"];

/**
 * Preseason runs to 4 ESPN weeks in seasons where the Hall of Fame game occupies
 * week 1, and 3 otherwise. Asking for a week that does not exist returns an empty
 * event list rather than an error, so walking 1..4 unconditionally is safe and
 * saves us hard-coding a convention we cannot verify ahead of time.
 */
export const PRESEASON_WEEKS = [1, 2, 3, 4];
export const REGULAR_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

export function weeksFor(seasonType: SeasonType): number[] {
  if (seasonType === "pre") return PRESEASON_WEEKS;
  if (seasonType === "post") return [1, 2, 3, 5];
  return REGULAR_WEEKS;
}

export interface FetchScheduleOptions {
  season: number;
  seasonTypes?: SeasonType[];
  /** Restrict to these week numbers (applies to every requested season type). */
  weeks?: number[];
  /** Pause between requests, ms. Politeness toward an unofficial endpoint. */
  delayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called after each week is fetched. Returning `false` stops the walk cleanly,
   * keeping everything gathered so far — used to bail out before the host's
   * function timeout rather than being killed mid-flight with nothing to show.
   */
  onWeek?: (outcome: WeekFetchOutcome) => boolean | void | Promise<boolean | void>;
}

export interface WeekFetchOutcome {
  seasonType: SeasonType;
  week: number;
  /** Games kept after validation. */
  games: Game[];
  /** Events dropped because a team id wasn't one of the 32. */
  rejected: { id: string; home: string; away: string }[];
  /** Set when the request itself failed; the walk continues regardless. */
  error?: string;
}

export interface FetchScheduleResult {
  season: number;
  outcomes: WeekFetchOutcome[];
  /** Every valid game found, deduplicated by provider id. */
  games: Game[];
  /** True when `onWeek` stopped the walk early, so coverage is incomplete. */
  stoppedEarly: boolean;
  /** Weeks never attempted because the walk stopped. Never silently dropped. */
  skipped: WeekTarget[];
}

export interface WeekTarget {
  seasonType: SeasonType;
  week: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk a season week by week and collect every game.
 *
 * Deliberately SEQUENTIAL with a small delay: this is an undocumented, free,
 * unauthenticated endpoint and firing 22 concurrent requests at it is how you get
 * rate-limited off it. One week takes ~200ms, so a full season is a few seconds.
 *
 * A failing week is recorded and skipped rather than aborting the walk — a partial
 * schedule that reports its gaps is far more useful than an all-or-nothing load,
 * and re-running is idempotent (upsert on provider id).
 */
export async function fetchSchedule(
  provider: NflProvider,
  opts: FetchScheduleOptions,
): Promise<FetchScheduleResult> {
  const seasonTypes = opts.seasonTypes ?? (["pre", "regular"] as SeasonType[]);
  const delayMs = opts.delayMs ?? 60;
  const sleep = opts.sleep ?? defaultSleep;

  // Flatten to an explicit target list so anything left unattempted after an early
  // stop can be reported rather than quietly missing.
  const targets: WeekTarget[] = [];
  for (const seasonType of seasonTypes) {
    for (const week of weeksFor(seasonType)) {
      if (opts.weeks && !opts.weeks.includes(week)) continue;
      targets.push({ seasonType, week });
    }
  }

  const outcomes: WeekFetchOutcome[] = [];
  const byId = new Map<string, Game>();
  let stoppedEarly = false;
  let i = 0;

  for (; i < targets.length; i += 1) {
    const { seasonType, week } = targets[i]!;
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const outcome: WeekFetchOutcome = { seasonType, week, games: [], rejected: [] };
    try {
      const fetched = await provider.getWeekGames({ season: opts.season, week, seasonType });
      for (const game of fetched) {
        // games.home/away are bare text with no foreign key or check constraint, so
        // the database will happily store "" or a typo forever. This is the only
        // gate. WeekSchedule looks every id up in TEAMS and a miss used to take the
        // whole picks page down.
        if (!getTeam(game.home) || !getTeam(game.away)) {
          outcome.rejected.push({ id: game.id, home: game.home, away: game.away });
          continue;
        }
        outcome.games.push(game);
        byId.set(game.id, game);
      }
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err);
    }
    outcomes.push(outcome);

    if (opts.onWeek && (await opts.onWeek(outcome)) === false) {
      stoppedEarly = true;
      i += 1; // this target was attempted; the remainder were not
      break;
    }
  }

  return {
    season: opts.season,
    outcomes,
    games: [...byId.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    stoppedEarly,
    skipped: stoppedEarly ? targets.slice(i) : [],
  };
}

/** Domain game → `games` row. The one place this mapping lives. */
export function gameToRow(game: Game, nowIso: string): GameInsert {
  return {
    id: game.id,
    season: game.season,
    season_type: game.seasonType,
    week: game.week,
    kickoff: game.kickoff,
    status: game.status,
    home: game.home,
    away: game.away,
    home_score: game.homeScore,
    away_score: game.awayScore,
    status_detail: game.statusDetail ?? null,
    updated_at: nowIso,
  };
}

/**
 * Upsert games on the provider id.
 *
 * `onConflict: "id"` is not incidental — the primary key IS the ESPN event id, so
 * the bulk loader and the 5-minute scorer converge on the same row per game
 * instead of racing to insert duplicates. Chunked because a full season is ~320
 * rows and a single statement that large is needlessly fragile.
 */
export async function upsertGames(
  supabase: DB,
  games: Game[],
  opts: { now?: Date; chunkSize?: number } = {},
): Promise<{ upserted: number; error?: string }> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const chunkSize = opts.chunkSize ?? 100;
  let upserted = 0;

  for (let i = 0; i < games.length; i += chunkSize) {
    const chunk = games.slice(i, i + chunkSize).map((g) => gameToRow(g, nowIso));
    const { error } = await supabase.from("games").upsert(chunk, { onConflict: "id" });
    if (error) return { upserted, error: error.message };
    upserted += chunk.length;
  }

  return { upserted };
}

export interface ScheduleSummaryLine {
  seasonType: SeasonType;
  week: number;
  games: number;
  rejected: number;
  error?: string;
}

/** Per-week breakdown keyed on what the games actually SAY they are. */
export function summarize(result: FetchScheduleResult): {
  lines: ScheduleSummaryLine[];
  totals: Record<SeasonType, number>;
  rejected: WeekFetchOutcome["rejected"];
  errors: { seasonType: SeasonType; week: number; error: string }[];
  firstKickoff: string | null;
  lastKickoff: string | null;
} {
  // Group by the game's own season_type/week rather than the requested one: if the
  // endpoint ignores a parameter, this is where it becomes visible instead of
  // being quietly papered over.
  const counts = new Map<string, ScheduleSummaryLine>();
  for (const game of result.games) {
    const key = `${game.seasonType}:${game.week}`;
    const line = counts.get(key) ?? {
      seasonType: game.seasonType,
      week: game.week,
      games: 0,
      rejected: 0,
    };
    line.games += 1;
    counts.set(key, line);
  }

  const totals: Record<SeasonType, number> = { pre: 0, regular: 0, post: 0 };
  for (const game of result.games) totals[game.seasonType] += 1;

  const rejected = result.outcomes.flatMap((o) => o.rejected);
  const errors = result.outcomes
    .filter((o) => o.error)
    .map((o) => ({ seasonType: o.seasonType, week: o.week, error: o.error! }));

  const order: Record<SeasonType, number> = { pre: 0, regular: 1, post: 2 };
  const lines = [...counts.values()].sort(
    (a, b) => order[a.seasonType] - order[b.seasonType] || a.week - b.week,
  );

  return {
    lines,
    totals,
    rejected,
    errors,
    firstKickoff: result.games[0]?.kickoff ?? null,
    lastKickoff: result.games[result.games.length - 1]?.kickoff ?? null,
  };
}

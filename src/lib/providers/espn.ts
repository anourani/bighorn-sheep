import type { Game, GameStatus, SeasonType } from "../nfl/types";
import { teamFromAbbr } from "../nfl/teams";
import { espnToSeasonType, seasonTypeToEspn, type NflProvider, type WeekQuery } from "./types";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Minimal projection of the (undocumented) ESPN scoreboard payload. */
interface EspnResponse {
  events?: EspnEvent[];
}
interface EspnEvent {
  id?: string;
  date?: string;
  week?: { number?: number };
  season?: { year?: number; type?: number };
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}
interface EspnCompetition {
  date?: string;
  status?: EspnStatus;
  competitors?: EspnCompetitor[];
}
interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { abbreviation?: string };
}
interface EspnStatus {
  type?: { name?: string; state?: string; completed?: boolean; shortDetail?: string };
}

/**
 * Map ESPN's status vocabulary onto our closed `GameStatus` set. We key off
 * `type.name` (the most specific field) and fall back to `state`.
 */
function mapStatus(status: EspnStatus | undefined): { status: GameStatus; detail?: string } {
  const type = status?.type;
  const name = type?.name ?? "";
  const detail = type?.shortDetail;

  if (name.includes("POSTPONED") || name.includes("CANCELED") || name.includes("SUSPENDED")) {
    return { status: "postponed", detail };
  }
  if (name.includes("DELAYED")) return { status: "delayed", detail };
  if (name.includes("FINAL") || type?.completed) return { status: "final", detail };
  if (
    name.includes("IN_PROGRESS") ||
    name.includes("HALFTIME") ||
    name.includes("END_PERIOD") ||
    type?.state === "in"
  ) {
    return { status: "in_progress", detail };
  }
  return { status: "scheduled", detail };
}

function parseScore(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeEvent(event: EspnEvent, query: WeekQuery): Game | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  const home = teamFromAbbr(homeC?.team?.abbreviation ?? "");
  const away = teamFromAbbr(awayC?.team?.abbreviation ?? "");
  const kickoff = competition?.date ?? event.date;
  if (!home || !away || !kickoff || !event.id) return null;

  const { status, detail } = mapStatus(competition?.status ?? event.status);

  return {
    id: event.id,
    season: event.season?.year ?? query.season,
    // Believe the event over the request. `seasontype` is not always honoured by
    // this undocumented endpoint, and taking it from the query would file
    // regular-season games as preseason during a bulk load — exactly the
    // mislabelling season_type exists to prevent. Query is the fallback only.
    seasonType: espnToSeasonType(event.season?.type) ?? query.seasonType ?? "regular",
    week: event.week?.number ?? query.week,
    kickoff: new Date(kickoff).toISOString(),
    status,
    home: home.id,
    away: away.id,
    homeScore: parseScore(homeC?.score),
    awayScore: parseScore(awayC?.score),
    statusDetail: detail,
  };
}

export interface EspnProviderOptions {
  /** Abort the request after this many ms (default 8000). */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Primary v1 provider: the free, unauthenticated ESPN scoreboard endpoint.
 * One call returns the whole week — kickoff, status, and score per game — which
 * is exactly the surface the pick/lock/elimination engine needs.
 *
 * Risk (per PRD): this API is undocumented and can change without notice. The
 * admin manual-result override is the mitigation; failures here throw so the
 * caller (scheduled job) can log and fall back rather than silently corrupt.
 */
export class EspnProvider implements NflProvider {
  readonly name = "espn";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EspnProviderOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getWeekGames(query: WeekQuery): Promise<Game[]> {
    const seasonType: SeasonType = query.seasonType ?? "regular";
    const params = new URLSearchParams({
      dates: String(query.season),
      seasontype: String(seasonTypeToEspn(seasonType)),
      week: String(query.week),
    });
    const url = `${ESPN_SCOREBOARD}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let payload: EspnResponse;
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`ESPN scoreboard responded ${res.status}`);
      }
      payload = (await res.json()) as EspnResponse;
    } finally {
      clearTimeout(timer);
    }

    return (payload.events ?? [])
      .map((event) => normalizeEvent(event, { ...query, seasonType }))
      .filter((g): g is Game => g !== null)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }
}

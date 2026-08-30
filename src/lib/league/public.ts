import type { Game, TeamId } from "../nfl/types";
import { FINAL_WEEK } from "../nfl/calendar";
import { evaluateTeamPick } from "../game/elimination";
import { resolveCurrentWeek, seasonPhase, type SeasonPhase } from "../game/season";
import { countdown } from "../time";
import { buildGameIndex } from "./games";
import { survivorCounts, type HeadcountInput } from "./view";
import type { GroupRules, HistoryPick, Member } from "./types";

/**
 * The published league, shaped for the signed-out landing page.
 *
 * Everything here is serializable — no functions, no `Date` — because it
 * crosses the RSC boundary into `PublicStandings`.
 */
export interface PublicLeagueData {
  leagueName: string;
  season: number;
  rules: GroupRules;
  members: Member[];
  /**
   * Regular-season games for `currentWeek` ONLY, not the whole season.
   *
   * INVARIANT: `StandingsGrid.cellFor` consults `gameForTeam` exclusively from
   * its `week === currentWeek` branch — earlier weeks read `member.history`
   * (result already baked in) and later weeks short-circuit to an empty cell.
   * Narrowing here ships ~16 rows instead of ~272. If the grid ever looks up
   * another week, this filter has to go. `public.test.ts` pins the invariant.
   */
  games: Game[];
  nowIso: string;
  currentWeek: number;
  finalWeek: number;
  phase: SeasonPhase;
  hiddenPickUserIds: string[];
  /** Precomputed so the label row and the cube grid read one object. */
  headcount: HeadcountInput;
}

interface RawPick {
  week: number;
  team_id: string;
  game_id: string;
  result: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toGame(raw: unknown): Game | null {
  if (!isRecord(raw)) return null;
  const { id, season, week, kickoff, status, home, away } = raw;
  if (typeof id !== "string" || typeof week !== "number" || typeof kickoff !== "string") {
    return null;
  }
  return {
    id,
    season: typeof season === "number" ? season : 0,
    seasonType: "regular",
    week,
    kickoff,
    status: status as Game["status"],
    home: home as TeamId,
    away: away as TeamId,
    homeScore: typeof raw.home_score === "number" ? raw.home_score : null,
    awayScore: typeof raw.away_score === "number" ? raw.away_score : null,
    statusDetail: typeof raw.status_detail === "string" ? raw.status_detail : undefined,
  };
}

/**
 * Validate and map the `public_league_snapshot()` payload.
 *
 * Pure and total: any shape it doesn't recognise returns null rather than
 * throwing, because the only caller is the front door and a stranger cannot act
 * on a stack trace.
 *
 * The order of operations below is load-bearing — see the numbered comments.
 */
export function mapPublicSnapshot(raw: unknown, fallbackNow: Date): PublicLeagueData | null {
  // 1. Structural guard.
  if (!isRecord(raw)) return null;
  const group = raw.group;
  if (!isRecord(group)) return null;
  if (!Array.isArray(raw.members) || !Array.isArray(raw.games)) return null;

  const leagueName = typeof group.name === "string" ? group.name : "";
  const season = typeof group.season === "number" ? group.season : 0;
  const entryClosesAt = typeof group.entry_closes_at === "string" ? group.entry_closes_at : null;
  if (!entryClosesAt) return null;

  const rules: GroupRules = {
    eliminationType: group.elimination_type === "two_time" ? "two_time" : "single",
    tieRule: group.tie_rule === "loss" ? "loss" : "push",
  };

  // 2. The database clock wins, so this reveal logic agrees with what the SQL
  //    actually filtered on rather than with a drifting server clock.
  const now = typeof raw.now === "string" ? new Date(raw.now) : fallbackNow;

  // 3. Index ALL games first — step 5 needs `gameById` to derive results for
  //    picks the scorer hasn't written yet.
  const allGames = raw.games.map(toGame).filter((g): g is Game => g !== null);
  const idx = buildGameIndex(allGames);

  // 4. Phase and week come from the same helpers loadLeague() uses, so the
  //    landing page and the app cannot drift on what "this week" means.
  const phase = seasonPhase(new Date(entryClosesAt), now);
  const currentWeek = resolveCurrentWeek({ phase, now, games: allGames, finalWeek: FINAL_WEEK });

  // 5. Members. Every pick in the payload is already revealed — the SQL dropped
  //    the rest — so this splits by week alone and never re-derives privacy.
  const members: Member[] = raw.members.filter(isRecord).map((m) => {
    const rawPicks = Array.isArray(m.picks) ? m.picks.filter(isRecord) : [];
    const history: HistoryPick[] = [];
    let currentPick: Member["currentPick"] = null;

    for (const p of rawPicks as unknown as RawPick[]) {
      if (typeof p.week !== "number" || typeof p.team_id !== "string") continue;
      if (p.week === currentWeek) {
        currentPick = { week: p.week, teamId: p.team_id as TeamId, gameId: p.game_id };
        continue;
      }
      // Trust the scored value, else derive it — same rule as load.ts's
      // historyResult, which is why step 3 has to precede this.
      const stored = p.result;
      const result =
        stored === "win" || stored === "loss" || stored === "push"
          ? stored
          : ((d) => (d === "win" || d === "loss" || d === "push" ? d : null))(
              evaluateTeamPick(idx.gameById(p.game_id) ?? null, p.team_id as TeamId, rules),
            );
      if (result) history.push({ week: p.week, teamId: p.team_id as TeamId, result });
    }

    return {
      id: String(m.id ?? ""),
      // Already abbreviated to "Alex N." in SQL so the full surname never left
      // the database. Do NOT run formatDisplayName over it again.
      name: typeof m.name === "string" ? m.name : "Player",
      // The public payload carries no name parts, avatar, phone or buy-in.
      // A null animal is what drives the avatar, so signed-out visitors get the
      // initials mark — and the SQL never selects favorite_animal either way.
      firstName: "",
      lastName: "",
      favoriteAnimal: null,
      phone: null,
      buyInPaid: false,
      // Neither travels on the public payload, and neither is rendered there:
      // `public_league_snapshot` filters to season_type = 'regular', so preseason
      // is absent by construction rather than by this flag.
      buyInPaidAt: null,
      showPreseason: false,
      role: m.role === "admin" ? "admin" : "player",
      status: m.status === "eliminated" ? "eliminated" : "alive",
      strikes: typeof m.strikes === "number" ? m.strikes : 0,
      eliminatedWeek: typeof m.eliminated_week === "number" ? m.eliminated_week : null,
      history,
      currentPick,
    };
  });

  // 6. Padlocks, narrowed to the current week. The payload carries
  //    {member_id, week} pairs precisely so a member whose only un-kicked pick
  //    is for a LATER week doesn't light one in this week's column.
  const hiddenRaw = Array.isArray(raw.hidden_picks) ? raw.hidden_picks.filter(isRecord) : [];
  const hiddenPickUserIds = hiddenRaw
    .filter((h) => h.week === currentWeek)
    .map((h) => String(h.member_id));

  // 7. The headcount line. Preseason is the state this ships in.
  const headcount: HeadcountInput =
    phase === "preseason"
      ? {
          kind: "preseason",
          joined: members.length,
          startsIn: countdown(new Date(entryClosesAt), now).label,
        }
      : { kind: "season", week: currentWeek, ...survivorCounts(members) };

  return {
    leagueName,
    season,
    rules,
    members,
    // 8. See the INVARIANT on `games` above.
    games: allGames.filter((g) => g.week === currentWeek),
    nowIso: now.toISOString(),
    currentWeek,
    finalWeek: FINAL_WEEK,
    phase,
    hiddenPickUserIds,
    headcount,
  };
}

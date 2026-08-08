import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { computeStatus, evaluateWeek } from "./elimination";
import type { GroupRules, PickResult } from "../league/types";
import type { Game } from "../nfl/types";

/**
 * Shared scoring core. The Netlify scheduled scorer and the pre-season dry-run
 * harness (`scripts/sim-advance.ts`) BOTH call this, so a simulated weekend
 * resolves picks and eliminations through the identical engine the real season
 * uses — no drift between "test" and "prod" logic.
 *
 * Writes assume a service-role client (RLS bypassed): it updates every affected
 * pick's `result`/`locked_at` and every member's `strikes`/`status`/
 * `eliminated_week` for the given season, folding weeks 1..throughWeek.
 *
 * REGULAR SEASON ONLY. Both queries below filter `season_type = 'regular'`.
 * Preseason is a practice round that resets at Week 1: its results are derived at
 * read time and never written to `group_members`. Without these filters a
 * preseason loss would strike a member in the real league, and preseason week N
 * would be folded in as if it were regular week N.
 */
type DB = SupabaseClient<Database>;
type GameRow = Database["public"]["Tables"]["games"]["Row"];
type PickRow = Database["public"]["Tables"]["picks"]["Row"];

export function rowToGame(r: GameRow): Game {
  return {
    id: r.id,
    season: r.season,
    seasonType: r.season_type,
    week: r.week,
    kickoff: r.kickoff,
    status: r.status,
    home: r.home,
    away: r.away,
    homeScore: r.home_score,
    awayScore: r.away_score,
    statusDetail: r.status_detail ?? undefined,
  };
}

export async function recomputeSeason(
  supabase: DB,
  season: number,
  throughWeek: number,
  now: Date = new Date(),
): Promise<{ membersUpdated: number }> {
  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .eq("season_type", "regular")
    .lte("week", throughWeek);
  const games = (gameRows ?? []).map(rowToGame);

  const byId = new Map<string, Game>(games.map((g) => [g.id, g]));
  const finalKickoffByWeek = new Map<number, string>();
  for (const g of games) {
    const cur = finalKickoffByWeek.get(g.week);
    if (!cur || g.kickoff > cur) finalKickoffByWeek.set(g.week, g.kickoff);
  }

  const { data: groups } = await supabase.from("groups").select("*").eq("season", season);
  let membersUpdated = 0;

  for (const group of groups ?? []) {
    const rules: GroupRules = {
      eliminationType: group.elimination_type,
      tieRule: group.tie_rule,
    };
    const { data: members } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", group.id);
    const { data: pickRows } = await supabase
      .from("picks")
      .select("*")
      .eq("group_id", group.id)
      .eq("season_type", "regular");

    const picksByUser = new Map<string, PickRow[]>();
    for (const p of pickRows ?? []) {
      const arr = picksByUser.get(p.user_id) ?? [];
      arr.push(p);
      picksByUser.set(p.user_id, arr);
    }

    for (const member of members ?? []) {
      const userPicks = (picksByUser.get(member.user_id) ?? []).sort((a, b) => a.week - b.week);
      const weeks: number[] = [];
      const results: PickResult[] = [];

      for (let w = 1; w <= throughWeek; w++) {
        const pick = userPicks.find((p) => p.week === w) ?? null;
        const game = pick ? (byId.get(pick.game_id) ?? null) : null;
        const wf = finalKickoffByWeek.get(w);
        const result = evaluateWeek({
          teamId: pick?.team_id ?? null,
          game,
          weekFinalKickoff: wf ? new Date(wf) : new Date(8640000000000000),
          rules,
          now,
        });
        weeks.push(w);
        results.push(result);

        if (pick && result !== "no_pick") {
          const locked = game && new Date(game.kickoff) <= now ? game.kickoff : null;
          await supabase.from("picks").update({ result, locked_at: locked }).eq("id", pick.id);
        }
      }

      const status = computeStatus(rules, results, weeks);
      const { error } = await supabase
        .from("group_members")
        .update({
          strikes: status.strikes,
          status: status.status,
          eliminated_week: status.eliminatedWeek,
        })
        .eq("id", member.id);
      if (!error) membersUpdated += 1;
    }
  }

  return { membersUpdated };
}

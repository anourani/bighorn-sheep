/*
 * Scheduled scorer — the heartbeat of the league.
 *
 * Runs on a cron during game windows and:
 *   1. Polls the NFL provider (ESPN by default) for the current week's games.
 *   2. Upserts them into Postgres — updating kickoff, status, and score. Because
 *      pick locks key off each game's kickoff, this is also what locks picks.
 *   3. Recomputes every affected member's result/strikes/elimination using the
 *      SAME pure engine the app and tests use (src/lib/game/elimination.ts), so
 *      standings reflect a Thursday-night loss on Thursday, not end-of-week.
 *
 * Writes use the Supabase service role, which bypasses RLS. No-ops cleanly when
 * Supabase isn't configured, so it's safe to deploy before secrets are set.
 *
 * Netlify v2 function: default export + `config.schedule`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { getNflProvider } from "../../src/lib/providers";
import { computeStatus, evaluateWeek } from "../../src/lib/game/elimination";
import type { GroupRules, PickResult } from "../../src/lib/league/types";
import type { Game } from "../../src/lib/nfl/types";

export const config = {
  // Every 5 minutes. In production, narrow this to Thu/Sun/Mon game windows.
  schedule: "*/5 * * * *",
};

type DB = SupabaseClient<Database>;
type GameRow = Database["public"]["Tables"]["games"]["Row"];
type PickRow = Database["public"]["Tables"]["picks"]["Row"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rowToGame(r: GameRow): Game {
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

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ skipped: "supabase-not-configured" });

  const season = Number(process.env.NFL_SEASON ?? new Date().getUTCFullYear());
  const week = Number(process.env.NFL_WEEK ?? 1);

  // 1) Poll the provider.
  let games: Game[];
  try {
    games = await getNflProvider().getWeekGames({ season, week });
  } catch (err) {
    return json({ ok: false, stage: "provider", error: String(err) }, 502);
  }

  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  // 2) Upsert games (kickoff/status/score). Locks picks implicitly via kickoff.
  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("games").upsert(
    games.map((g) => ({
      id: g.id,
      season: g.season,
      season_type: g.seasonType,
      week: g.week,
      kickoff: g.kickoff,
      status: g.status,
      home: g.home,
      away: g.away,
      home_score: g.homeScore,
      away_score: g.awayScore,
      status_detail: g.statusDetail ?? null,
      updated_at: nowIso,
    })),
    { onConflict: "id" },
  );
  if (upsertErr) return json({ ok: false, stage: "games-upsert", error: upsertErr.message }, 500);

  // 3) Recompute eliminations.
  try {
    const result = await recomputeEliminations(supabase, season, week);
    return json({ ok: true, week, gamesUpserted: games.length, ...result });
  } catch (err) {
    return json({ ok: false, stage: "recompute", error: String(err) }, 500);
  }
}

async function recomputeEliminations(supabase: DB, season: number, week: number) {
  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .lte("week", week);
  const games = (gameRows ?? []).map(rowToGame);

  const byId = new Map<string, Game>(games.map((g) => [g.id, g]));
  const finalKickoffByWeek = new Map<number, string>();
  for (const g of games) {
    const cur = finalKickoffByWeek.get(g.week);
    if (!cur || g.kickoff > cur) finalKickoffByWeek.set(g.week, g.kickoff);
  }

  const { data: groups } = await supabase.from("groups").select("*").eq("season", season);
  const now = new Date();
  let membersUpdated = 0;

  for (const group of groups ?? []) {
    const rules: GroupRules = {
      eliminationType: group.elimination_type,
      tieRule: group.tie_rule,
    };
    const { data: members } = await supabase.from("group_members").select("*").eq("group_id", group.id);
    const { data: pickRows } = await supabase.from("picks").select("*").eq("group_id", group.id);

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

      for (let w = 1; w <= week; w++) {
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

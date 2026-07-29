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
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { getNflProvider } from "../../src/lib/providers";
import { recomputeSeason } from "../../src/lib/game/score";
import type { Game } from "../../src/lib/nfl/types";

export const config = {
  // Every 5 minutes. In production, narrow this to Thu/Sun/Mon game windows.
  schedule: "*/5 * * * *",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

  // 3) Recompute eliminations (shared engine — see src/lib/game/score.ts).
  try {
    const result = await recomputeSeason(supabase, season, week);
    return json({ ok: true, week, gamesUpserted: games.length, ...result });
  } catch (err) {
    return json({ ok: false, stage: "recompute", error: String(err) }, 500);
  }
}

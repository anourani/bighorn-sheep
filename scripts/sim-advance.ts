import { serviceClient, arg, listArg, isUuid } from "./lib";
import { recomputeSeason } from "../src/lib/game/score";

/**
 * Fast-forward a seeded test weekend so you can watch the whole survival loop
 * resolve in minutes instead of waiting for real kickoffs. It moves games'
 * kickoffs into the past and flips their status, then recomputes results and
 * eliminations through the SAME engine the real scorer uses.
 *
 * Two phases, applied to all of the week's games or a targeted subset:
 *
 *   --phase kickoff   Games kick off now: status → in_progress, kickoff → past.
 *                     Picks lock and reveal (rivals' teams become visible).
 *
 *   --phase final     Games end: status → final with scores. Winners you name
 *                     win; everyone else's result (and any missed pick = loss)
 *                     is computed, and eliminations/strikes update.
 *
 * Usage:
 *   npm run sim -- --season 2026 --week 1 --phase kickoff --group BIGHORN-7F3K
 *   npm run sim -- --season 2026 --week 1 --phase final --winners kc,dal,buf --group BIGHORN-7F3K
 *
 * Flags:
 *   --phase     "kickoff" | "final"            (default: final)
 *   --season    season year                    (default: current UTC year)
 *   --week      week number                     (default: 1)
 *   --games     comma-list of game ids to target (default: all in the week)
 *   --winners   comma-list of team ids that should win their game (final only)
 *   --group     group id/code to keep entry deadline in sync with kickoff
 */
async function main(): Promise<void> {
  const supabase = serviceClient();
  const season = Number(arg("season", String(new Date().getUTCFullYear())));
  const week = Number(arg("week", "1"));
  const phase = (arg("phase", "final") ?? "final").toLowerCase();
  const winners = listArg("winners");
  const only = listArg("games");
  const groupRef = arg("group");

  const { data: allRows, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .eq("week", week);
  if (error) throw error;

  const weekGames = allRows ?? [];
  const targets = only.length ? weekGames.filter((g) => only.includes(g.id)) : weekGames;
  if (targets.length === 0) {
    console.log("No matching games — did you run seed:test-week first?");
    return;
  }

  const now = Date.now();

  if (phase === "kickoff") {
    const kickoffIso = new Date(now - 60_000).toISOString(); // 1 min ago
    for (const g of targets) {
      const { error: uErr } = await supabase
        .from("games")
        .update({ status: "in_progress", kickoff: kickoffIso, status_detail: "1st 15:00", updated_at: new Date().toISOString() })
        .eq("id", g.id);
      if (uErr) throw uErr;
    }
    console.log(`✓ Kicked off ${targets.length} game(s) — picks now lock and reveal.`);
  } else if (phase === "final") {
    const kickoffIso = new Date(now - 3 * 3_600_000).toISOString(); // 3h ago
    for (const g of targets) {
      const homeWins =
        winners.length === 0
          ? Math.random() < 0.5
          : winners.includes(g.home)
            ? true
            : winners.includes(g.away)
              ? false
              : Math.random() < 0.5;
      const homeScore = homeWins ? 24 : 17;
      const awayScore = homeWins ? 17 : 24;
      const { error: uErr } = await supabase
        .from("games")
        .update({
          status: "final",
          kickoff: kickoffIso,
          home_score: homeScore,
          away_score: awayScore,
          status_detail: "Final",
          updated_at: new Date().toISOString(),
        })
        .eq("id", g.id);
      if (uErr) throw uErr;
      console.log(`   ${g.id}: ${g.away} ${awayScore} @ ${g.home} ${homeScore} → ${homeWins ? g.home : g.away} wins`);
    }
    console.log(`✓ Finalized ${targets.length} game(s).`);
  } else {
    throw new Error(`Unknown --phase "${phase}" (expected "kickoff" or "final").`);
  }

  // Keep the group's entry deadline consistent with the earliest kickoff now in
  // the past, so the app flips out of pre-season once any game has started.
  if (groupRef) {
    const { data: fresh } = await supabase
      .from("games")
      .select("kickoff")
      .eq("season", season)
      .eq("week", week);
    const earliest = (fresh ?? [])
      .map((g) => g.kickoff)
      .sort()
      .at(0);
    if (earliest) {
      const column = isUuid(groupRef) ? "id" : "invite_code";
      await supabase.from("groups").update({ entry_closes_at: earliest }).eq(column, groupRef);
      console.log(`✓ Synced entry deadline to earliest kickoff (${earliest}).`);
    }
  }

  const res = await recomputeSeason(supabase, season, week);
  console.log(`✓ Recomputed standings — ${res.membersUpdated} member(s) updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

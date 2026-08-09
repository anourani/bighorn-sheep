import { serviceClient, arg, flag, listArg, isUuid } from "./lib";
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
 * ONLY TOUCHES SEEDED GAMES (ids prefixed `test-`) unless you pass --force. It
 * fabricates kickoffs and final scores, so pointed at a real slate it would invent
 * results for actual NFL games and eliminate real members on them. Restricted to
 * `season_type = 'regular'` for the same reason — preseason practice resolves from
 * the real feed, not from here.
 *
 * Flags:
 *   --phase     "kickoff" | "final"            (default: final)
 *   --season    season year                    (default: current UTC year)
 *   --week      week number                     (default: 1)
 *   --games     comma-list of game ids to target (default: all seeded in the week)
 *   --winners   comma-list of team ids that should win their game (final only)
 *   --group     group id/code — scopes BOTH the entry deadline and the recompute
 *   --force     also advance real (non-seeded) games — invents NFL results
 *
 * Flags accept either `--name value` or `--name=value`.
 */
async function main(): Promise<void> {
  const supabase = serviceClient();
  const season = Number(arg("season", String(new Date().getUTCFullYear())));
  const week = Number(arg("week", "1"));
  const phase = (arg("phase", "final") ?? "final").toLowerCase();
  const winners = listArg("winners");
  const only = listArg("games");
  const groupRef = arg("group");
  const force = flag("force");

  const { data: allRows, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("week", week);
  if (error) throw error;

  const weekGames = allRows ?? [];
  const selected = only.length ? weekGames.filter((g) => only.includes(g.id)) : weekGames;

  // Fabricating a score onto a real game would eliminate real members on a result
  // the NFL never produced, and the next poll-scores run would then overwrite it —
  // leaving standings computed from a game that never happened.
  const realGames = selected.filter((g) => !g.id.startsWith("test-"));
  const targets = force ? selected : selected.filter((g) => g.id.startsWith("test-"));

  if (realGames.length > 0 && !force) {
    console.warn(
      `⚠  Skipping ${realGames.length} real game(s) in season ${season}, week ${week} — ` +
        `this script invents scores.\n   Pass --force only if you truly mean to.`,
    );
  }

  if (targets.length === 0) {
    console.log(
      realGames.length > 0
        ? "No seeded games to advance (only real ones, which were skipped)."
        : "No matching games — did you run seed:test-week first?",
    );
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

  // Resolve --group to an id up front: it scopes BOTH the deadline write and the
  // recompute below, and silently recomputing every league in the project because
  // a code was mistyped is not an acceptable failure mode.
  let groupId: string | undefined;
  if (groupRef) {
    const column = isUuid(groupRef) ? "id" : "invite_code";
    const { data: grp, error: gErr } = await supabase
      .from("groups")
      .select("id, name")
      .eq(column, groupRef)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!grp) {
      console.error(`✗ No group matched "${groupRef}". Nothing was recomputed.`);
      process.exit(1);
    }
    groupId = grp.id;

    // Keep the group's entry deadline consistent with the earliest kickoff now in
    // the past, so the app flips out of pre-season once any game has started.
    //
    // Scoped to regular-season SEEDED rows, matching the main query above. Without
    // the season_type filter this reads the preseason slate too — and since
    // (season 2026, week 1) holds both the August Hall of Fame game and the
    // September opener, `.sort().at(0)` picked August and set entry_closes_at to
    // it, instantly closing entry and destroying the preseason practice round.
    const { data: fresh } = await supabase
      .from("games")
      .select("id, kickoff")
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("week", week);
    const earliest = (fresh ?? [])
      .filter((g) => force || g.id.startsWith("test-"))
      .map((g) => g.kickoff)
      .sort()
      .at(0);
    if (earliest) {
      await supabase.from("groups").update({ entry_closes_at: earliest }).eq("id", groupId);
      console.log(`✓ Synced "${grp.name}" entry deadline to earliest kickoff (${earliest}).`);
    }
  } else {
    console.warn(
      "⚠  No --group given, so the recompute covers EVERY league in this season.\n" +
        "   Pass --group <id|code> to scope it to one.",
    );
  }

  const res = await recomputeSeason(supabase, season, week, new Date(), { groupId });
  console.log(`✓ Recomputed standings — ${res.membersUpdated} member(s) updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

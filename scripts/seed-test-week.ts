import { serviceClient, arg, isUuid } from "./lib";
import { TEAMS } from "../src/lib/nfl/teams";
import type { Database } from "../src/lib/supabase/types";

/**
 * Seed a controllable "test weekend" of games so a real group of friends can run
 * the whole pick → lock → reveal → result loop BEFORE the NFL season starts.
 *
 * It inserts a slate for one season/week with kickoffs staggered a few minutes
 * out from now (so everything is still pickable), and — if you point it at your
 * group — sets that group's entry deadline to the first kickoff, so the app sits
 * in its pre-season/entry-open state until you advance it with sim-advance.
 *
 * Usage:
 *   npm run seed:test-week -- --season 2026 --week 1 --kickoff-in 10 --group BIGHORN-7F3K
 *
 * Flags (all optional):
 *   --season       season year        (default: current UTC year)
 *   --week         week number        (default: 1)
 *   --kickoff-in   minutes until the first game kicks off (default: 10)
 *   --spacing      minutes between kickoff slots           (default: 8)
 *   --group        group id OR invite code — aligns its entry deadline
 *
 * Re-running upserts the same game ids, so it's safe to run repeatedly.
 */
type GameInsert = Database["public"]["Tables"]["games"]["Insert"];

async function main(): Promise<void> {
  const supabase = serviceClient();
  const season = Number(arg("season", String(new Date().getUTCFullYear())));
  const week = Number(arg("week", "1"));
  const firstInMin = Number(arg("kickoff-in", "10"));
  const spacingMin = Number(arg("spacing", "8"));
  const groupRef = arg("group");

  const ids = TEAMS.map((t) => t.id);
  const slate = ids.slice(0, 16); // 16 teams → 8 games
  const base = Date.now();

  const games: GameInsert[] = [];
  for (let i = 0; i < slate.length; i += 2) {
    const slot = i / 2;
    const kickoff = new Date(base + (firstInMin + slot * spacingMin) * 60_000).toISOString();
    games.push({
      id: `test-${season}-${week}-${slot + 1}`,
      season,
      season_type: "regular",
      week,
      kickoff,
      status: "scheduled",
      home: slate[i]!,
      away: slate[i + 1]!,
      home_score: null,
      away_score: null,
      status_detail: null,
      updated_at: new Date().toISOString(),
    });
  }

  const { error } = await supabase.from("games").upsert(games, { onConflict: "id" });
  if (error) throw error;

  console.log(`✓ Seeded ${games.length} games — season ${season}, week ${week}.`);
  for (const g of games) console.log(`   ${g.id}   ${g.away} @ ${g.home}   ${g.kickoff}`);

  if (groupRef) {
    const firstKickoff = games[0]!.kickoff;
    const column = isUuid(groupRef) ? "id" : "invite_code";
    const { data, error: gErr } = await supabase
      .from("groups")
      .update({ entry_closes_at: firstKickoff })
      .eq(column, groupRef)
      .select("id, name");
    if (gErr) throw gErr;
    if (!data || data.length === 0) {
      console.log(`⚠  No group matched "${groupRef}" — entry deadline unchanged.`);
    } else {
      console.log(`✓ Set "${data[0]!.name}" entry deadline to first kickoff (${firstKickoff}).`);
    }
  } else {
    console.log("ℹ  Pass --group <id|code> to align your league's entry deadline to kickoff.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

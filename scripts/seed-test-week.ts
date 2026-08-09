import { serviceClient, arg, flag, isUuid } from "./lib";
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
 * REFUSES TO RUN if that (season, week) already holds real games, because these
 * are fabricated rows in the same `games` table as the real schedule and
 * `gameForTeam` returns the FIRST match in a week — so a fake game would shadow a
 * real one and a member could be shown, or pick, a game that does not exist. Once
 * the real schedule is loaded there is nothing left to rehearse; use a week the
 * league hasn't published, or `--force` if you know what you're doing.
 *
 * If a previous dry run already wrote rows on top of a real season, clean them out
 * with supabase/cleanup-test-games.sql (picks first, then games — the foreign key
 * forbids the other order).
 *
 * Flags (all optional):
 *   --season       season year        (default: current UTC year)
 *   --week         week number        (default: 1)
 *   --force        seed even if real games already exist for that week
 *   --kickoff-in   minutes until the first game kicks off (default: 10)
 *   --spacing      minutes between kickoff slots           (default: 8)
 *   --group        group id OR invite code — aligns its entry deadline
 *
 * Re-running upserts the same game ids, so it's safe to run repeatedly.
 */
type GameInsert = Database["public"]["Tables"]["games"]["Insert"];

/** Fabricated rows are all id-prefixed, which is what makes them identifiable. */
const TEST_ID_PREFIX = "test-";

async function main(): Promise<void> {
  const supabase = serviceClient();
  const season = Number(arg("season", String(new Date().getUTCFullYear())));
  const week = Number(arg("week", "1"));
  const firstInMin = Number(arg("kickoff-in", "10"));
  const spacingMin = Number(arg("spacing", "8"));
  const groupRef = arg("group");
  const force = flag("force");

  // Never fabricate games on top of a real slate. The app resolves a team's game
  // for a week by taking the first match, so a test row alongside a real one is a
  // coin flip over which schedule a member sees.
  const { data: existing, error: existingErr } = await supabase
    .from("games")
    .select("id")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("week", week);
  if (existingErr) throw existingErr;

  const real = (existing ?? []).filter((g) => !g.id.startsWith(TEST_ID_PREFIX));
  if (real.length > 0 && !force) {
    console.error(
      `✗ Season ${season}, week ${week} already has ${real.length} real game(s).\n` +
        `  Seeding fake games there would shadow them on the picks screen.\n` +
        `  Pick a week the league hasn't published, or pass --force to override.`,
    );
    process.exit(1);
  }
  if (real.length > 0) {
    console.warn(
      `⚠  --force: seeding 8 fake games alongside ${real.length} real one(s) in ` +
        `season ${season}, week ${week}. Clean up with supabase/cleanup-test-games.sql.`,
    );
  }

  const ids = TEAMS.map((t) => t.id);
  const slate = ids.slice(0, 16); // 16 teams → 8 games
  const base = Date.now();

  const games: GameInsert[] = [];
  for (let i = 0; i < slate.length; i += 2) {
    const slot = i / 2;
    const kickoff = new Date(base + (firstInMin + slot * spacingMin) * 60_000).toISOString();
    games.push({
      id: `${TEST_ID_PREFIX}${season}-${week}-${slot + 1}`,
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

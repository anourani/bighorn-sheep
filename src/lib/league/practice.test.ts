import { describe, expect, it } from "vitest";
import { derivePractice, practiceUsedTeams, type PracticePickInput } from "./practice";
import type { Game } from "../nfl/types";
import type { GroupRules } from "./types";

const SINGLE: GroupRules = { eliminationType: "single", tieRule: "push" };
const TWO_TIME: GroupRules = { eliminationType: "two_time", tieRule: "push" };

/**
 * A preseason slate: 2 games a week across weeks 1-3, so every week has both a
 * winner and a loser to pick, plus teams on bye.
 */
function preGame(
  week: number,
  home: string,
  away: string,
  opts: { homeScore?: number; awayScore?: number; final?: boolean } = {},
): Game {
  const day = 7 + week * 7;
  return {
    id: `pre-${week}-${home}`,
    season: 2026,
    seasonType: "pre",
    week,
    kickoff: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    status: opts.final ? "final" : "scheduled",
    home,
    away,
    homeScore: opts.homeScore ?? null,
    awayScore: opts.awayScore ?? null,
  };
}

const FINISHED = { final: true, homeScore: 24, awayScore: 10 }; // home wins

const MATCHUPS: [number, string, string][] = [
  [1, "kc", "phi"],
  [1, "buf", "nyj"],
  [2, "sf", "dal"],
  [2, "bal", "cin"],
  [3, "gb", "chi"],
  [3, "det", "min"],
];

/**
 * The slate as it would actually look at a moment in time: games whose kickoff has
 * passed are final, later ones still scheduled. Marking every game final regardless
 * of `now` produces a schedule that cannot exist, and the code reads game status —
 * so a fixture like that tests the wrong thing.
 */
function slateAsOf(now: Date): Game[] {
  return MATCHUPS.map(([week, home, away]) => {
    const g = preGame(week, home, away);
    return new Date(g.kickoff).getTime() <= now.getTime()
      ? preGame(week, home, away, FINISHED)
      : g;
  });
}

const AFTER_PRESEASON = new Date("2026-09-01T00:00:00.000Z");

/** Every preseason game played — the state the practice round ends in. */
const SLATE: Game[] = slateAsOf(AFTER_PRESEASON);

function pick(week: number, teamId: string, userId = "u1"): PracticePickInput {
  const game = SLATE.find((g) => g.week === week && (g.home === teamId || g.away === teamId))!;
  return { userId, week, teamId, gameId: game.id };
}

describe("derivePractice", () => {
  it("returns null when there is no preseason schedule", () => {
    expect(
      derivePractice({ games: [], picks: [], memberIds: ["u1"], rules: SINGLE, now: AFTER_PRESEASON }),
    ).toBeNull();
  });

  it("reports the weeks present and the live one", () => {
    // Week 1 (Aug 14) is over; week 2 (Aug 21) hasn't kicked off yet.
    const now = new Date("2026-08-15T12:00:00.000Z");
    const state = derivePractice({
      games: slateAsOf(now),
      picks: [],
      memberIds: ["u1"],
      rules: SINGLE,
      now,
    })!;

    expect(state.weeks).toEqual([1, 2, 3]);
    expect(state.maxPreWeek).toBe(3);
    // Week 2, not week 1: the live practice week is the earliest one you can still
    // pick, so a finished week never strands the picker with nothing selectable.
    expect(state.currentWeek).toBe(2);
  });

  it("holds on the last week once every preseason game has kicked off", () => {
    const state = derivePractice({
      games: SLATE,
      picks: [],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;
    expect(state.currentWeek).toBe(3);
  });

  it("eliminates on a losing practice pick — practice is played for real", () => {
    const state = derivePractice({
      games: SLATE,
      picks: [pick(1, "phi")], // phi lost
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    expect(state.members.u1).toMatchObject({
      status: "eliminated",
      strikes: 1,
      eliminatedWeek: 1,
    });
  });

  it("keeps a winner alive", () => {
    const state = derivePractice({
      games: SLATE,
      picks: [pick(1, "kc"), pick(2, "sf"), pick(3, "gb")], // all home winners
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    expect(state.members.u1).toMatchObject({ status: "alive", strikes: 0 });
    // Week 3 is the live week (currentWeek caps at the last preseason week), so it
    // sits in currentPick rather than settled history — the same split the regular
    // season uses. Its result still counts toward elimination.
    expect(state.members.u1!.history.map((h) => h.result)).toEqual(["win", "win"]);
    expect(state.members.u1!.currentPick).toMatchObject({ week: 3, teamId: "gb" });
  });

  it("honours the group's strike allowance", () => {
    const losing = [pick(1, "phi"), pick(2, "dal")];
    const single = derivePractice({
      games: SLATE,
      picks: losing,
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;
    const twoTime = derivePractice({
      games: SLATE,
      picks: losing,
      memberIds: ["u1"],
      rules: TWO_TIME,
      now: AFTER_PRESEASON,
    })!;

    expect(single.members.u1!.eliminatedWeek).toBe(1);
    expect(twoTime.members.u1!.eliminatedWeek).toBe(2);
  });

  // A member who has not picked in a week that hasn't finished must not be struck
  // for it — the missed-pick rule only bites after the week's final kickoff.
  it("does not punish a missing pick for a week still to come", () => {
    const state = derivePractice({
      games: SLATE,
      picks: [],
      memberIds: ["u1"],
      rules: SINGLE,
      now: new Date("2026-08-13T00:00:00.000Z"), // before week 1's kickoff
    })!;

    expect(state.members.u1).toMatchObject({ status: "alive", strikes: 0 });
  });

  it("gives every member an entry, including those who never picked", () => {
    const state = derivePractice({
      games: SLATE,
      picks: [pick(1, "kc", "u1")],
      memberIds: ["u1", "u2"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    expect(Object.keys(state.members).sort()).toEqual(["u1", "u2"]);
    expect(state.members.u2).toMatchObject({
      status: "alive",
      strikes: 0,
      participating: false,
    });
  });

  /*
   * Preseason has no entry deadline — `entry_closes_at` gates the regular season
   * only — so folding every preseason week would strike a member for weeks that
   * finished before they ever signed up. With the Hall of Fame game played in early
   * August, a brand-new account was derived `eliminated` on arrival and submitPick
   * refused every practice pick with "You're eliminated": the practice round was
   * unusable for exactly the newcomers it exists for.
   */
  it("does not retroactively eliminate someone who joins mid-preseason", () => {
    const state = derivePractice({
      games: SLATE,
      // Never picked in weeks 1-2 (both long finished); starts practising in week 3.
      picks: [pick(3, "gb")],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    expect(state.members.u1).toMatchObject({
      status: "alive",
      strikes: 0,
      participating: true,
    });
  });

  it("still counts a missed week once you are in the practice round", () => {
    const state = derivePractice({
      games: SLATE,
      // In from week 1, then skipped week 2 — which has finished.
      picks: [pick(1, "kc")],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    expect(state.members.u1).toMatchObject({ status: "eliminated", eliminatedWeek: 2 });
  });

  it("exposes the live week's pick separately from settled history", () => {
    // Week 1 done, week 2 (Aug 21) still to kick off.
    const now = new Date("2026-08-16T00:00:00.000Z");
    const state = derivePractice({
      games: slateAsOf(now),
      picks: [pick(1, "kc"), pick(2, "sf")],
      memberIds: ["u1"],
      rules: SINGLE,
      now,
    })!;

    expect(state.currentWeek).toBe(2);
    expect(state.members.u1!.currentPick).toMatchObject({ week: 2, teamId: "sf" });
    expect(state.members.u1!.history.map((h) => h.week)).toEqual([1]);
  });
});

describe("the Week 1 reset", () => {
  /*
   * The requirement: preseason is played for real, but at Week 1 everyone comes
   * back alive with 0 strikes and all 32 teams available, and preseason leaves the
   * standings.
   *
   * There is no reset code to test, and that is the point. Practice standing is
   * derived from `season_type = 'pre'` rows and lives nowhere else — group_members
   * is written only by recomputeSeason, which filters to 'regular'. So the reset is
   * the loader ceasing to build this object. These pin the two halves of that.
   */

  it("derives eliminated in practice and alive in the real league from the same rows", () => {
    const practice = derivePractice({
      games: SLATE,
      picks: [pick(1, "phi")],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    // Practice: gone.
    expect(practice.members.u1!.status).toBe("eliminated");

    // The regular season asks the same question of a regular-season slice, which
    // these preseason picks are not part of at all.
    const regular = derivePractice({
      games: [],
      picks: [pick(1, "phi")],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    });
    expect(regular).toBeNull();
  });

  it("keeps used teams per-phase, so a team practised in preseason comes back", () => {
    const practice = derivePractice({
      games: SLATE,
      picks: [pick(1, "kc"), pick(2, "sf")],
      memberIds: ["u1"],
      rules: SINGLE,
      now: AFTER_PRESEASON,
    })!;

    const used = practiceUsedTeams(practice.members.u1).map((u) => u.teamId);
    expect(used).toContain("kc");
    expect(used).toContain("sf");

    // Nothing here reaches the regular season's used-team list, which is built
    // from Member.history in load.ts and never sees a 'pre' pick.
    expect(practice.members.u1!.history.every((h) => h.week <= 3)).toBe(true);
  });
});

describe("practiceUsedTeams", () => {
  const state = derivePractice({
    games: SLATE,
    picks: [pick(1, "kc"), pick(2, "sf")],
    memberIds: ["u1"],
    rules: SINGLE,
    now: new Date("2026-08-22T00:00:00.000Z"), // week 2 live
  })!;

  it("counts settled picks and the live one", () => {
    expect(practiceUsedTeams(state.members.u1).map((u) => u.teamId).sort()).toEqual(["kc", "sf"]);
  });

  // The current week's own pick has to be replaceable, so it is excluded when
  // validating a new pick for that same week.
  it("excludes the week being re-picked", () => {
    expect(
      practiceUsedTeams(state.members.u1, { excludeWeek: 2 }).map((u) => u.teamId),
    ).toEqual(["kc"]);
  });

  it("is empty for a member with no practice picks", () => {
    expect(practiceUsedTeams(undefined)).toEqual([]);
  });

  /*
   * Built from `picks`, not `history`. A pick whose game hasn't gone final has no
   * result, so it never reaches `history` — and with SUPABASE_SERVICE_ROLE_KEY unset
   * today no game EVER goes final. A history-based list therefore re-offered a team
   * the member had already spent, and the database's unique violation surfaced as a
   * generic server error.
   */
  it("counts a pick whose game has not resolved", () => {
    const unresolved: Game[] = [
      preGame(1, "kc", "phi"), // no scores, status "scheduled"
      preGame(2, "sf", "dal"),
    ];
    const state = derivePractice({
      games: unresolved,
      picks: [{ userId: "u1", week: 1, teamId: "kc", gameId: "pre-1-kc" }],
      memberIds: ["u1"],
      rules: SINGLE,
      now: new Date("2026-08-16T00:00:00.000Z"),
    })!;

    // Nothing resolved, so history is empty …
    expect(state.members.u1!.history).toEqual([]);
    // … but the team is unambiguously spent.
    expect(practiceUsedTeams(state.members.u1).map((u) => u.teamId)).toEqual(["kc"]);
  });
});

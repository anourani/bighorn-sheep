import { describe, expect, it } from "vitest";
import {
  alignEntryDeadlines,
  fetchSchedule,
  gameToRow,
  pollTargets,
  summarize,
  weeksFor,
} from "./schedule";
import type { NflProvider, WeekQuery } from "../providers/types";
import type { Game, SeasonType } from "./types";

function game(overrides: Partial<Game> & { id: string }): Game {
  return {
    season: 2026,
    seasonType: "regular",
    week: 1,
    kickoff: "2026-09-10T00:20:00.000Z",
    status: "scheduled",
    home: "sea",
    away: "ne",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

/** A provider that answers from a fixture, and records what it was asked. */
function stubProvider(
  answer: (q: WeekQuery) => Game[] | Error,
): NflProvider & { calls: WeekQuery[] } {
  const calls: WeekQuery[] = [];
  return {
    name: "stub",
    calls,
    async getWeekGames(q) {
      calls.push(q);
      const result = answer(q);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const noSleep = async (): Promise<void> => {};

/** A `games` row as the scorer reads it. */
interface Row {
  season_type: SeasonType;
  week: number;
  kickoff: string;
}

describe("weeksFor", () => {
  // 4 rather than 3: in seasons where the Hall of Fame game occupies preseason
  // week 1 the three real preseason weeks shift to 2-4. Asking for a week that
  // doesn't exist returns an empty list, so over-asking is free.
  it("walks four preseason weeks and eighteen regular ones", () => {
    expect(weeksFor("pre")).toEqual([1, 2, 3, 4]);
    expect(weeksFor("regular")).toHaveLength(18);
    expect(weeksFor("regular")[17]).toBe(18);
  });
});

describe("fetchSchedule", () => {
  it("walks both phases and dedupes by provider id", async () => {
    const provider = stubProvider((q) =>
      q.week <= 2 ? [game({ id: `g-${q.seasonType}-${q.week}`, week: q.week })] : [],
    );

    const result = await fetchSchedule(provider, { season: 2026, sleep: noSleep });

    expect(provider.calls).toHaveLength(4 + 18);
    expect(provider.calls[0]).toMatchObject({ seasonType: "pre", week: 1 });
    expect(provider.calls[4]).toMatchObject({ seasonType: "regular", week: 1 });
    expect(result.games.map((g) => g.id).sort()).toEqual([
      "g-pre-1",
      "g-pre-2",
      "g-regular-1",
      "g-regular-2",
    ]);
  });

  // games.home/away are bare text with no FK and no check constraint, so this is
  // the only thing standing between a feed change and a permanently corrupt row.
  it("rejects games whose team codes aren't among the 32", async () => {
    const provider = stubProvider((q) =>
      q.seasonType === "pre" && q.week === 1
        ? [
            game({ id: "good", home: "kc", away: "phi" }),
            game({ id: "bad-home", home: "xxx", away: "phi" }),
            game({ id: "bad-away", home: "kc", away: "" }),
          ]
        : [],
    );

    const result = await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["pre"],
      sleep: noSleep,
    });

    expect(result.games.map((g) => g.id)).toEqual(["good"]);
    expect(result.outcomes[0]!.rejected.map((r) => r.id)).toEqual(["bad-home", "bad-away"]);
  });

  // A partial schedule that reports its gaps beats an all-or-nothing load: the
  // walk is idempotent, so re-running fills them in.
  it("records a failing week and keeps walking", async () => {
    const provider = stubProvider((q) => {
      if (q.week === 2) return new Error("ESPN scoreboard responded 503");
      return [game({ id: `g-${q.week}`, week: q.week })];
    });

    const result = await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["pre"],
      sleep: noSleep,
    });

    expect(result.games.map((g) => g.id)).toEqual(["g-1", "g-3", "g-4"]);
    const failed = result.outcomes.find((o) => o.week === 2)!;
    expect(failed.error).toContain("503");
  });

  it("sorts by kickoff", async () => {
    const provider = stubProvider((q) =>
      q.week === 1
        ? [
            game({ id: "late", kickoff: "2026-09-14T00:20:00.000Z" }),
            game({ id: "early", kickoff: "2026-09-10T00:20:00.000Z" }),
          ]
        : [],
    );
    const result = await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["regular"],
      sleep: noSleep,
    });
    expect(result.games.map((g) => g.id)).toEqual(["early", "late"]);
  });

  it("honours an explicit week list", async () => {
    const provider = stubProvider((q) => [game({ id: `g-${q.seasonType}-${q.week}`, week: q.week })]);
    await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["regular"],
      weeks: [3, 7],
      sleep: noSleep,
    });
    expect(provider.calls.map((c) => c.week)).toEqual([3, 7]);
  });

  /*
   * The walk is 22 upstream requests, which can outlast a synchronous function's
   * execution limit. `onWeek` returning false stops it cleanly so the caller can
   * persist what it has and report the gap, instead of being killed mid-walk with
   * nothing written and nothing said.
   */
  it("stops when onWeek returns false and reports what it never reached", async () => {
    const provider = stubProvider((q) => [game({ id: `g-${q.seasonType}-${q.week}`, week: q.week })]);
    const seen: number[] = [];

    const result = await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["pre"],
      sleep: noSleep,
      onWeek: (o) => {
        seen.push(o.week);
        return o.week < 2; // stop after week 2
      },
    });

    expect(seen).toEqual([1, 2]);
    expect(result.stoppedEarly).toBe(true);
    expect(result.games).toHaveLength(2); // week 2's games are kept, not discarded
    expect(result.skipped).toEqual([
      { seasonType: "pre", week: 3 },
      { seasonType: "pre", week: 4 },
    ]);
  });

  it("reports nothing skipped on a complete walk", async () => {
    const provider = stubProvider(() => []);
    const result = await fetchSchedule(provider, {
      season: 2026,
      seasonTypes: ["pre"],
      sleep: noSleep,
      onWeek: () => true,
    });
    expect(result.stoppedEarly).toBe(false);
    expect(result.skipped).toEqual([]);
  });
});

describe("summarize", () => {
  // Grouped by what the games SAY they are, not what was requested — so an
  // endpoint that ignores `seasontype` shows up in the report instead of being
  // silently papered over.
  it("counts by the game's own season type and week", () => {
    const summary = summarize({
      season: 2026,
      stoppedEarly: false,
      skipped: [],
      outcomes: [
        {
          seasonType: "pre",
          week: 1,
          games: [],
          rejected: [{ id: "junk", home: "xxx", away: "phi" }],
        },
        { seasonType: "regular", week: 1, games: [], rejected: [], error: "boom" },
      ],
      games: [
        game({ id: "a", seasonType: "pre", week: 1, kickoff: "2026-08-07T00:00:00.000Z" }),
        game({ id: "b", seasonType: "pre", week: 2, kickoff: "2026-08-14T00:00:00.000Z" }),
        game({ id: "c", seasonType: "regular", week: 1, kickoff: "2026-09-10T00:20:00.000Z" }),
        game({ id: "d", seasonType: "regular", week: 1, kickoff: "2026-09-13T17:00:00.000Z" }),
      ],
    });

    expect(summary.totals).toEqual({ pre: 2, regular: 2, post: 0 });
    expect(summary.lines).toEqual([
      { seasonType: "pre", week: 1, games: 1, rejected: 0 },
      { seasonType: "pre", week: 2, games: 1, rejected: 0 },
      { seasonType: "regular", week: 1, games: 2, rejected: 0 },
    ]);
    expect(summary.firstKickoff).toBe("2026-08-07T00:00:00.000Z");
    expect(summary.lastKickoff).toBe("2026-09-13T17:00:00.000Z");
    expect(summary.rejected).toHaveLength(1);
    expect(summary.errors).toEqual([{ seasonType: "regular", week: 1, error: "boom" }]);
  });

  it("orders preseason before regular season", () => {
    const summary = summarize({
      season: 2026,
      stoppedEarly: false,
      skipped: [],
      outcomes: [],
      games: [
        game({ id: "r", seasonType: "regular" as SeasonType, week: 1 }),
        game({ id: "p", seasonType: "pre" as SeasonType, week: 4 }),
      ],
    });
    expect(summary.lines.map((l) => l.seasonType)).toEqual(["pre", "regular"]);
  });
});

describe("gameToRow", () => {
  it("maps the domain shape onto the games row", () => {
    const row = gameToRow(
      game({ id: "401", seasonType: "pre", week: 2, homeScore: 17, awayScore: 10, status: "final", statusDetail: "Final" }),
      "2026-08-14T03:00:00.000Z",
    );
    expect(row).toEqual({
      id: "401",
      season: 2026,
      season_type: "pre",
      week: 2,
      kickoff: "2026-09-10T00:20:00.000Z",
      status: "final",
      home: "sea",
      away: "ne",
      home_score: 17,
      away_score: 10,
      status_detail: "Final",
      updated_at: "2026-08-14T03:00:00.000Z",
    });
  });

  it("nulls a missing status detail rather than writing undefined", () => {
    expect(gameToRow(game({ id: "x" }), "2026-01-01T00:00:00.000Z").status_detail).toBeNull();
  });
});

describe("pollTargets", () => {
  /*
   * These pin the behaviour that replaced `process.env.NFL_WEEK`. The old code
   * polled exactly one week, defaulting to 1, which is why the games table never
   * held more than the Week 1 slate.
   */
  const PRE: Row[] = [
    { season_type: "pre", week: 1, kickoff: "2026-08-07T00:00:00.000Z" },
    { season_type: "pre", week: 2, kickoff: "2026-08-14T00:00:00.000Z" },
    { season_type: "pre", week: 3, kickoff: "2026-08-21T00:00:00.000Z" },
    { season_type: "pre", week: 4, kickoff: "2026-08-28T00:00:00.000Z" },
  ];

  const REGULAR: Row[] = [
    { season_type: "regular", week: 1, kickoff: "2026-09-10T00:20:00.000Z" },
    { season_type: "regular", week: 1, kickoff: "2026-09-14T00:20:00.000Z" }, // Mon night
    { season_type: "regular", week: 2, kickoff: "2026-09-17T00:20:00.000Z" }, // Thu opener
    { season_type: "regular", week: 3, kickoff: "2026-09-24T00:20:00.000Z" },
  ];

  const ALL = [...PRE, ...REGULAR];

  it("polls every preseason week while the regular season hasn't started", () => {
    const targets = pollTargets(ALL, new Date("2026-08-15T18:00:00.000Z"));
    expect(targets.filter((t) => t.seasonType === "pre").map((t) => t.week)).toEqual([1, 2, 3, 4]);
  });

  // The reason the previous week is polled at all. Week 2's Thursday opener has
  // moved currentWeek to 2 while Week 1's Monday-night game is still being
  // played; poll only the live week and that final score never lands, leaving a
  // member's result stuck on "pending" forever.
  it("polls the previous regular week so a Monday-night final still lands", () => {
    const targets = pollTargets(REGULAR, new Date("2026-09-17T02:00:00.000Z"));
    expect(targets).toEqual([
      { seasonType: "regular", week: 1 },
      { seasonType: "regular", week: 2 },
    ]);
  });

  it("stops polling preseason once the regular season is underway", () => {
    const targets = pollTargets(ALL, new Date("2026-09-11T00:00:00.000Z"));
    expect(targets.some((t) => t.seasonType === "pre")).toBe(false);
  });

  it("has no previous week to poll in Week 1", () => {
    const targets = pollTargets(REGULAR, new Date("2026-09-10T01:00:00.000Z"));
    expect(targets).toEqual([{ seasonType: "regular", week: 1 }]);
  });

  // Before any football at all, there is nothing to look back at, but Week 1 is
  // still worth polling: that is how a schedule change to the opener is picked up.
  it("polls Week 1 before the season starts, plus the practice slate", () => {
    const targets = pollTargets(ALL, new Date("2026-08-01T00:00:00.000Z"));
    expect(targets).toEqual([
      { seasonType: "pre", week: 1 },
      { seasonType: "pre", week: 2 },
      { seasonType: "pre", week: 3 },
      { seasonType: "pre", week: 4 },
      { seasonType: "regular", week: 1 },
    ]);
  });

  it("caps at the final week", () => {
    const late: Row[] = [
      { season_type: "regular", week: 18, kickoff: "2027-01-03T18:00:00.000Z" },
    ];
    const targets = pollTargets(late, new Date("2027-02-01T00:00:00.000Z"));
    expect(targets).toEqual([
      { seasonType: "regular", week: 17 },
      { seasonType: "regular", week: 18 },
    ]);
  });

  it("survives a preseason-only schedule", () => {
    const targets = pollTargets(PRE, new Date("2026-08-15T18:00:00.000Z"));
    expect(targets.filter((t) => t.seasonType === "pre")).toHaveLength(4);
    // No regular rows yet, so the derived regular week floors at 1.
    expect(targets.filter((t) => t.seasonType === "regular")).toEqual([
      { seasonType: "regular", week: 1 },
    ]);
  });
});

// ── alignEntryDeadlines ──────────────────────────────────────────────────────

/**
 * A stub standing in for the two queries alignEntryDeadlines makes: a filtered,
 * ordered read of `games`, and a read plus per-row update of `groups`. The repo has
 * no database-test harness, and building one for two statements would cost more
 * than it explains.
 */
interface StubGroup {
  id: string;
  name: string;
  entry_closes_at: string;
  season: number;
}

function stubDb(opts: { week1Kickoffs?: string[]; groups?: StubGroup[] }) {
  const updates: { id: string; entry_closes_at: string }[] = [];
  const groups = opts.groups ?? [];

  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    // Every filter/order call returns the same object; only the awaited value matters.
    for (const m of ["select", "eq", "order", "limit"]) {
      self[m] = () => self;
    }
    self.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return self;
  };

  const db = {
    from(table: string) {
      if (table === "games") {
        return chain((opts.week1Kickoffs ?? []).map((kickoff) => ({ kickoff })));
      }
      if (table === "groups") {
        return {
          select: () => ({
            eq: (_col: string, season: number) =>
              chain(groups.filter((g) => g.season === season)),
          }),
          update: (patch: { entry_closes_at: string }) => ({
            eq: (_col: string, id: string) => {
              updates.push({ id, entry_closes_at: patch.entry_closes_at });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  // The real signature is SupabaseClient<Database>; the stub only implements the
  // fragment this function touches.
  return { db: db as unknown as Parameters<typeof alignEntryDeadlines>[0], updates };
}

const WEEK1 = "2026-09-10T00:20:00.000Z";
const BEFORE_SEASON = new Date("2026-08-09T00:00:00.000Z");

describe("alignEntryDeadlines", () => {
  /*
   * The bug: create_group defaults entry_closes_at to `now() + 7 days`, so a league
   * created in August closed its own entry a week later — and join_by_invite then
   * refuses every new member permanently, with no override in the app.
   */
  it("moves a stale creation+7d deadline onto the real Week 1 kickoff", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1, "2026-09-13T17:00:00.000Z"],
      groups: [
        { id: "g1", name: "Group Name", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 },
      ],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON);

    expect(res.skipped).toBeNull();
    expect(res.firstKickoff).toBe(WEEK1);
    expect(res.changed).toEqual([
      { id: "g1", name: "Group Name", from: "2026-08-15T17:33:00.000Z", to: WEEK1 },
    ]);
    expect(updates).toEqual([{ id: "g1", entry_closes_at: WEEK1 }]);
  });

  it("leaves an already-correct league untouched", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [{ id: "g1", name: "Correct", entry_closes_at: WEEK1, season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON);

    expect(res.changed).toEqual([]);
    expect(res.alreadyAligned).toBe(1);
    expect(updates).toEqual([]);
  });

  // Postgres may return a different string form of the same instant.
  it("compares instants, not strings", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [
        { id: "g1", name: "Same moment", entry_closes_at: "2026-09-10T02:20:00+02:00", season: 2026 },
      ],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON);
    expect(res.alreadyAligned).toBe(1);
    expect(updates).toEqual([]);
  });

  // Safe to call after a `&phase=pre` load, or one that stopped before Week 1.
  it("does nothing when no regular Week 1 games are loaded", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [],
      groups: [{ id: "g1", name: "Group", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON);

    expect(res.skipped).toBe("no-week-1");
    expect(res.firstKickoff).toBeNull();
    expect(updates).toEqual([]);
  });

  /*
   * The guard that matters most. Once Week 1 has genuinely kicked off, pushing a
   * deadline forward would reopen entry and resurrect the practice round on a live
   * league. Note it keys off the REAL kickoff, not the stored value.
   */
  it("refuses to touch anything once Week 1 has kicked off", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [{ id: "g1", name: "Live league", entry_closes_at: WEEK1, season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, new Date("2026-10-01T00:00:00.000Z"));

    expect(res.skipped).toBe("season-started");
    expect(updates).toEqual([]);
  });

  it("still repairs a deadline that lapsed early, as long as Week 1 is still ahead", async () => {
    // Someone runs the loader on Aug 20 — the stale Aug 15 deadline has already
    // passed and entry is wrongly shut, but the season hasn't started.
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [{ id: "g1", name: "Frozen", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, new Date("2026-08-20T00:00:00.000Z"));

    expect(res.skipped).toBeNull();
    expect(updates).toEqual([{ id: "g1", entry_closes_at: WEEK1 }]);
  });

  it("only touches leagues in the requested season", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [
        { id: "now", name: "This year", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 },
        { id: "old", name: "Last year", entry_closes_at: "2025-09-05T00:20:00.000Z", season: 2025 },
      ],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON);

    expect(res.changed.map((c) => c.id)).toEqual(["now"]);
    expect(updates.map((u) => u.id)).toEqual(["now"]);
  });

  it("reports what it would change without writing, on a dry run", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [WEEK1],
      groups: [{ id: "g1", name: "Group", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON, { dryRun: true });

    expect(res.changed).toHaveLength(1);
    expect(updates).toEqual([]);
  });

  // The loader passes this so a dry run can preview before the games are written.
  it("accepts a kickoff hint instead of querying", async () => {
    const { db, updates } = stubDb({
      week1Kickoffs: [], // nothing in the database yet
      groups: [{ id: "g1", name: "Group", entry_closes_at: "2026-08-15T17:33:00.000Z", season: 2026 }],
    });

    const res = await alignEntryDeadlines(db, 2026, BEFORE_SEASON, { firstKickoff: WEEK1 });

    expect(res.skipped).toBeNull();
    expect(res.firstKickoff).toBe(WEEK1);
    expect(updates).toEqual([{ id: "g1", entry_closes_at: WEEK1 }]);
  });
});

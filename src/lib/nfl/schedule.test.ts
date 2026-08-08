import { describe, expect, it } from "vitest";
import { fetchSchedule, gameToRow, summarize, weeksFor } from "./schedule";
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

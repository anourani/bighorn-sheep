import { describe, expect, it } from "vitest";
import {
  isEntryOpen,
  isJoinOpen,
  joinClosesAt,
  resolveCurrentWeek,
  resolvePickWeek,
  resolveWeekFromKickoffs,
  seasonPhase,
} from "./season";
import { REGULAR_WEEKS } from "../nfl/calendar";

const ENTRY = new Date("2025-09-05T00:20:00.000Z"); // first Week 1 kickoff

describe("seasonPhase", () => {
  it("is preseason before the first Week 1 kickoff", () => {
    expect(seasonPhase(ENTRY, new Date("2025-08-28T12:00:00.000Z"))).toBe("preseason");
  });

  it("is regular once entry has closed", () => {
    expect(seasonPhase(ENTRY, new Date("2025-10-12T17:30:00.000Z"))).toBe("regular");
  });

  it("treats the exact kickoff instant as no-longer-preseason", () => {
    expect(seasonPhase(ENTRY, ENTRY)).toBe("regular");
  });

  it("is ended when the caller says the season resolved, regardless of clock", () => {
    expect(seasonPhase(ENTRY, new Date("2025-08-01T00:00:00.000Z"), true)).toBe("ended");
  });
});

describe("isEntryOpen", () => {
  it("mirrors the preseason window", () => {
    expect(isEntryOpen(ENTRY, new Date("2025-08-28T12:00:00.000Z"))).toBe(true);
    expect(isEntryOpen(ENTRY, new Date("2025-09-06T00:00:00.000Z"))).toBe(false);
  });
});

/*
 * THE JOIN WINDOW (migration 0018), which is a different fact from the one
 * above and is the whole reason both exist.
 *
 * `entry_closes_at` used to carry two meanings at once: "joining stops" and
 * "the season has started". They were the same instant, so nothing forced them
 * apart — and then the league's actual rule turned out to be that entry runs to
 * the LAST kickoff of Week 1, five days after the first. Moving the one column
 * would have moved the phase with it.
 */
const JOIN = "2025-09-09T00:15:00.000Z"; // Monday night of Week 1
const LEAGUE = { entryClosesAt: ENTRY.toISOString(), joinClosesAt: JOIN };

describe("joinClosesAt", () => {
  it("is the league's join deadline when it has one", () => {
    expect(joinClosesAt(LEAGUE)).toBe(JOIN);
  });

  /*
   * The fallback IS the migration story, not defensive padding. 0018 is applied
   * by hand, so between the deploy and the paste `groups.join_closes_at` does
   * not exist and `select("*")` omits the key entirely — undefined, never null.
   * Both spellings must land on the old behaviour rather than on `undefined`,
   * which `new Date(undefined)` would turn into an Invalid Date and every
   * comparison below into a silent `false`: nobody could join at all.
   */
  it("falls back to the season start when the column is null or absent", () => {
    expect(joinClosesAt({ entryClosesAt: ENTRY.toISOString(), joinClosesAt: null })).toBe(
      ENTRY.toISOString(),
    );
    expect(joinClosesAt({ entryClosesAt: ENTRY.toISOString() })).toBe(ENTRY.toISOString());
  });
});

describe("isJoinOpen", () => {
  it("stays open through Week 1, after the season has already started", () => {
    const duringWeek1 = new Date("2025-09-07T18:00:00.000Z"); // Sunday afternoon
    // The two answers diverge, and that divergence is the feature.
    expect(isEntryOpen(ENTRY, duringWeek1)).toBe(false);
    expect(isJoinOpen(LEAGUE, duringWeek1)).toBe(true);
  });

  it("closes at the last Week 1 kickoff", () => {
    expect(isJoinOpen(LEAGUE, new Date(JOIN))).toBe(false);
    expect(isJoinOpen(LEAGUE, new Date("2025-09-09T00:14:59.000Z"))).toBe(true);
  });

  it("collapses onto the season start with no join deadline set", () => {
    const bare = { entryClosesAt: ENTRY.toISOString(), joinClosesAt: null };
    const duringWeek1 = new Date("2025-09-07T18:00:00.000Z");
    expect(isJoinOpen(bare, duringWeek1)).toBe(false);
  });
});

/*
 * The regression the split exists to prevent, pinned as one assertion: a later
 * join deadline must NOT drag the phase with it. If it did, the app would sit in
 * "preseason" through Week 1's games — practice standings board, preseason
 * headcount, and an admin able to rewrite the rules during live football.
 */
describe("seasonPhase is unmoved by the join window", () => {
  it("is already regular while joining is still open", () => {
    const duringWeek1 = new Date("2025-09-07T18:00:00.000Z");
    expect(seasonPhase(ENTRY, duringWeek1)).toBe("regular");
    expect(isJoinOpen(LEAGUE, duringWeek1)).toBe(true);
  });
});

describe("resolveCurrentWeek", () => {
  const games = [
    { week: 1, kickoff: "2025-09-05T00:20:00.000Z" },
    { week: 2, kickoff: "2025-09-12T00:20:00.000Z" },
    { week: 3, kickoff: "2025-09-19T00:20:00.000Z" },
  ];

  it("is always Week 1 in preseason", () => {
    expect(
      resolveCurrentWeek({ phase: "preseason", now: new Date("2025-08-28T00:00:00.000Z"), games }),
    ).toBe(1);
  });

  it("returns the greatest week that has already begun", () => {
    expect(
      resolveCurrentWeek({ phase: "regular", now: new Date("2025-09-14T00:00:00.000Z"), games }),
    ).toBe(2);
  });

  it("falls back to Week 1 before any week has begun", () => {
    expect(
      resolveCurrentWeek({ phase: "regular", now: new Date("2025-09-01T00:00:00.000Z"), games }),
    ).toBe(1);
  });

  it("caps at finalWeek", () => {
    expect(
      resolveCurrentWeek({
        phase: "regular",
        now: new Date("2030-01-01T00:00:00.000Z"),
        games: [{ week: 25, kickoff: "2025-09-05T00:20:00.000Z" }],
        finalWeek: 18,
      }),
    ).toBe(18);
  });
});

describe("resolveWeekFromKickoffs", () => {
  it("returns the greatest week whose first kickoff has passed", () => {
    const games = [
      { week: 1, kickoff: "2026-09-10T00:20:00.000Z" },
      { week: 2, kickoff: "2026-09-17T00:20:00.000Z" },
      { week: 3, kickoff: "2026-09-24T00:20:00.000Z" },
    ];
    expect(resolveWeekFromKickoffs(games, new Date("2026-09-19T00:00:00.000Z"))).toBe(2);
  });

  it("floors at 1 with no games at all", () => {
    expect(resolveWeekFromKickoffs([], new Date("2026-09-19T00:00:00.000Z"))).toBe(1);
  });

  // Reused by the preseason practice round against its own slice, where the last
  // week is 3 or 4 rather than 18.
  it("caps at the finalWeek it is given, so preseason can pass its own", () => {
    const pre = [
      { week: 1, kickoff: "2026-08-07T00:00:00.000Z" },
      { week: 4, kickoff: "2026-08-28T00:00:00.000Z" },
    ];
    expect(resolveWeekFromKickoffs(pre, new Date("2026-08-29T00:00:00.000Z"), 4)).toBe(4);
    expect(resolveWeekFromKickoffs(pre, new Date("2026-08-29T00:00:00.000Z"), 3)).toBe(3);
  });

  /*
   * The bug this whole season_type split exists to prevent. Before the loader
   * filtered by season_type, `games` held preseason AND regular rows and this
   * function saw only week numbers — so an August preseason week-3 kickoff made
   * the REGULAR season report itself as being in week 3, weeks before it started.
   *
   * The guarantee now is upstream: callers pass a single-season_type list. This
   * pins what happens either way.
   */
  it("would be fooled by a mixed list — which is why callers must filter", () => {
    const august = new Date("2026-08-22T00:00:00.000Z");
    const regularOnly = [{ week: 1, kickoff: "2026-09-10T00:20:00.000Z" }];
    const mixed = [
      ...regularOnly,
      { week: 3, kickoff: "2026-08-21T00:00:00.000Z" }, // preseason week 3
    ];

    expect(resolveWeekFromKickoffs(regularOnly, august)).toBe(1);
    expect(resolveWeekFromKickoffs(mixed, august)).toBe(3);
  });
});

describe("resolvePickWeek", () => {
  const regular = { liveWeek: 4, weeks: REGULAR_WEEKS };

  it("falls back to the live week when the caller names none", () => {
    // The mid-deploy case: a tab loaded before picking ahead shipped sends no
    // week at all, and must keep working. `??` rather than `||`, so a null over
    // the wire reads as "unspecified" too — and week 0 could never mean it.
    expect(resolvePickWeek({ requested: undefined, ...regular })).toEqual({ ok: true, week: 4 });
    expect(resolvePickWeek({ requested: null as unknown as undefined, ...regular })).toEqual({
      ok: true,
      week: 4,
    });
  });

  it("accepts the live week itself", () => {
    expect(resolvePickWeek({ requested: 4, ...regular })).toEqual({ ok: true, week: 4 });
  });

  it("accepts a week ahead of the live one", () => {
    expect(resolvePickWeek({ requested: 5, ...regular })).toEqual({ ok: true, week: 5 });
    expect(resolvePickWeek({ requested: 18, ...regular })).toEqual({ ok: true, week: 18 });
  });

  it("refuses a week that has already started", () => {
    expect(resolvePickWeek({ requested: 3, ...regular })).toEqual({
      ok: false,
      error: "week_already_started",
    });
    expect(resolvePickWeek({ requested: 1, ...regular })).toEqual({
      ok: false,
      error: "week_already_started",
    });
  });

  it("refuses a week past the end of the season", () => {
    expect(resolvePickWeek({ requested: 19, ...regular })).toEqual({
      ok: false,
      error: "bad_week",
    });
  });

  /**
   * The practice case, and the reason callers pass the authoritative slate
   * rather than a numeric range: a season that loaded three preseason weeks has
   * no P4 to pick, and saying so here beats the vaguer `no_game_for_team` the
   * guard would otherwise reach.
   */
  it("refuses a week the phase does not have", () => {
    expect(resolvePickWeek({ requested: 4, liveWeek: 1, weeks: [1, 2, 3] })).toEqual({
      ok: false,
      error: "bad_week",
    });
    expect(resolvePickWeek({ requested: 3, liveWeek: 1, weeks: [1, 2, 3] })).toEqual({
      ok: true,
      week: 3,
    });
  });

  /**
   * `submitPick` is a Server Action, i.e. a reachable HTTP endpoint — every one
   * of these can arrive on a hand-rolled POST, and `Number.isInteger` is what
   * takes them all in one predicate.
   */
  it("refuses anything that is not a whole week number", () => {
    const junk: unknown[] = [1.5, NaN, Infinity, -Infinity, -1, 0, "5"];
    for (const requested of junk) {
      expect(resolvePickWeek({ requested: requested as number, ...regular })).toEqual({
        ok: false,
        error: "bad_week",
      });
    }
  });
});

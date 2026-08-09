import { describe, expect, it } from "vitest";
import { isEntryOpen, resolveCurrentWeek, resolveWeekFromKickoffs, seasonPhase } from "./season";

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

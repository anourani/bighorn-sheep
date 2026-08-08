import { describe, expect, it } from "vitest";
import { pollTargets } from "./poll-scores";
import type { SeasonType } from "../../src/lib/nfl/types";

/**
 * These pin the behaviour that replaced `process.env.NFL_WEEK`. The old code
 * polled exactly one week, defaulting to 1, which is why the games table never
 * held more than the Week 1 slate.
 */

interface Row {
  season_type: SeasonType;
  week: number;
  kickoff: string;
}

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

describe("pollTargets", () => {
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
    const late = [
      { season_type: "regular" as SeasonType, week: 18, kickoff: "2027-01-03T18:00:00.000Z" },
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

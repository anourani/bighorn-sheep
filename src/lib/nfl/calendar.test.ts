import { describe, expect, it } from "vitest";
import {
  FINAL_WEEK,
  PRE_WEEK,
  REGULAR_WEEK,
  groupedWeekOptions,
  parseWeekKey,
  sameWeek,
  weekKey,
  weekLabel,
  weekShortLabel,
} from "./calendar";

describe("weekKey", () => {
  // The whole reason WeekRef exists: a bare week number cannot tell preseason
  // week 1 from opening Sunday, and the two used to collide in one Map bucket.
  it("distinguishes preseason week 1 from regular week 1", () => {
    expect(weekKey(PRE_WEEK(1))).not.toBe(weekKey(REGULAR_WEEK(1)));
  });

  it("round-trips through parseWeekKey", () => {
    expect(parseWeekKey(weekKey(PRE_WEEK(3)))).toEqual({ seasonType: "pre", week: 3 });
    expect(parseWeekKey(weekKey(REGULAR_WEEK(12)))).toEqual({ seasonType: "regular", week: 12 });
  });

  it("rejects malformed keys rather than guessing", () => {
    expect(parseWeekKey("week-4")).toBeNull();
    expect(parseWeekKey("regular:")).toBeNull();
    expect(parseWeekKey("regular:two")).toBeNull();
    expect(parseWeekKey("bogus:1")).toBeNull();
  });
});

describe("sameWeek", () => {
  it("compares both axes", () => {
    expect(sameWeek(PRE_WEEK(2), PRE_WEEK(2))).toBe(true);
    expect(sameWeek(PRE_WEEK(2), REGULAR_WEEK(2))).toBe(false);
  });
});

describe("weekLabel", () => {
  it("names regular weeks plainly", () => {
    expect(weekLabel(REGULAR_WEEK(1))).toBe("Week 1");
    expect(weekLabel(REGULAR_WEEK(18))).toBe("Week 18");
  });

  // ESPN's preseason numbering is not ours to assume — in some seasons the Hall
  // of Fame game occupies preseason week 1 and the three real preseason weeks
  // shift to 2-4; in others they are 1-3. maxPreWeek reads that off the loaded
  // schedule so both conventions label correctly.
  it("treats week 1 as the Hall of Fame game when the preseason runs to 4 weeks", () => {
    const opts = { maxPreWeek: 4 };
    expect(weekLabel(PRE_WEEK(1), opts)).toBe("Hall of Fame");
    expect(weekLabel(PRE_WEEK(2), opts)).toBe("Preseason 1");
    expect(weekLabel(PRE_WEEK(3), opts)).toBe("Preseason 2");
    expect(weekLabel(PRE_WEEK(4), opts)).toBe("Preseason 3");
  });

  it("numbers preseason weeks directly when there are only 3", () => {
    const opts = { maxPreWeek: 3 };
    expect(weekLabel(PRE_WEEK(1), opts)).toBe("Preseason 1");
    expect(weekLabel(PRE_WEEK(3), opts)).toBe("Preseason 3");
  });

  it("falls back to direct numbering when maxPreWeek is unknown", () => {
    expect(weekLabel(PRE_WEEK(2))).toBe("Preseason 2");
  });

  it("names postseason rounds", () => {
    expect(weekLabel({ seasonType: "post", week: 1 })).toBe("Wild Card");
    expect(weekLabel({ seasonType: "post", week: 5 })).toBe("Super Bowl");
  });
});

describe("weekShortLabel", () => {
  it("abbreviates for narrow columns", () => {
    expect(weekShortLabel(REGULAR_WEEK(7))).toBe("7");
    expect(weekShortLabel(PRE_WEEK(1), { maxPreWeek: 4 })).toBe("HOF");
    expect(weekShortLabel(PRE_WEEK(3), { maxPreWeek: 4 })).toBe("P2");
    expect(weekShortLabel(PRE_WEEK(3), { maxPreWeek: 3 })).toBe("P3");
  });
});

describe("groupedWeekOptions", () => {
  it("offers preseason then regular season while practice is live", () => {
    const groups = groupedWeekOptions({
      currentWeek: 1,
      practice: { weeks: [1, 2, 3], currentWeek: 2 },
    });

    expect(groups.map((g) => g.label)).toEqual(["Preseason", "Regular Season"]);
    expect(groups[0]!.options.map((o) => o.label)).toEqual([
      "Preseason 1",
      "Preseason 2",
      "Preseason 3",
    ]);
    expect(groups[0]!.options.filter((o) => o.isCurrent).map((o) => o.ref.week)).toEqual([2]);
    expect(groups[1]!.options).toHaveLength(FINAL_WEEK);
  });

  // Two "· current" options at once read as a contradiction, not as a phase
  // distinction: the dropdown said Preseason 2 and Week 1 were both current.
  // While practice is live the preseason owns the marker outright.
  it("marks exactly one week current across both groups", () => {
    const groups = groupedWeekOptions({
      currentWeek: 1,
      practice: { weeks: [1, 2, 3], currentWeek: 2 },
    });

    const current = groups.flatMap((g) => g.options).filter((o) => o.isCurrent);
    expect(current.map((o) => o.ref)).toEqual([{ seasonType: "pre", week: 2 }]);
  });

  // This is the Week 1 reset, seen from the UI: practice goes null and the whole
  // group vanishes. Nothing is deleted and no migration runs.
  it("drops the preseason group entirely once practice is over", () => {
    const groups = groupedWeekOptions({ currentWeek: 4, practice: null });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    expect(groups[0]!.options[0]!.ref).toEqual({ seasonType: "regular", week: 4 });
    // And the marker comes back to the regular season with the group gone.
    expect(groups[0]!.options.filter((o) => o.isCurrent).map((o) => o.ref.week)).toEqual([4]);
  });

  it("keeps regular weeks forward-only from the current week", () => {
    const groups = groupedWeekOptions({ currentWeek: 16 });
    expect(groups[0]!.options.map((o) => o.ref.week)).toEqual([16, 17, 18]);
  });

  it("ignores an empty practice slate", () => {
    const groups = groupedWeekOptions({ currentWeek: 1, practice: { weeks: [], currentWeek: 1 } });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    // No group on screen means nothing else can hold the marker.
    expect(groups[0]!.options.filter((o) => o.isCurrent).map((o) => o.ref.week)).toEqual([1]);
  });

  it("clamps a current week outside the season", () => {
    expect(groupedWeekOptions({ currentWeek: 0 })[0]!.options[0]!.ref.week).toBe(1);
    expect(groupedWeekOptions({ currentWeek: 99 })[0]!.options.map((o) => o.ref.week)).toEqual([18]);
  });
});

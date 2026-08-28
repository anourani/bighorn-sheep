import { describe, expect, it } from "vitest";
import {
  FINAL_WEEK,
  PRE_WEEK,
  REGULAR_WEEK,
  parseWeekKey,
  sameWeek,
  weekKey,
  weekLabel,
  weekShortLabel,
  weekShortName,
  weekStripOptions,
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

describe("weekStripOptions", () => {
  it("offers preseason then the regular season while practice is live", () => {
    const options = weekStripOptions({
      currentWeek: 1,
      practice: { weeks: [1, 2, 3], currentWeek: 2 },
    });

    expect(options).toHaveLength(3 + FINAL_WEEK);
    expect(options.slice(0, 3).map((o) => o.label)).toEqual([
      "Preseason 1",
      "Preseason 2",
      "Preseason 3",
    ]);
    expect(options[3]!.ref).toEqual({ seasonType: "regular", week: 1 });
    expect(options.filter((o) => o.isCurrent).map((o) => o.ref)).toEqual([
      { seasonType: "pre", week: 2 },
    ]);
  });

  // The rule this replaced: "regular weeks stay forward-only — a member cannot
  // browse to a week they have already played". Dropped deliberately. The strip
  // draws a played week as the team you spent there, and that state cannot exist
  // in a list that starts at the current week.
  it("includes every regular week, the ones already played included", () => {
    const options = weekStripOptions({ currentWeek: 16 });
    expect(options.map((o) => o.ref.week)).toEqual(
      Array.from({ length: FINAL_WEEK }, (_, i) => i + 1),
    );
    expect(options.filter((o) => o.isCurrent).map((o) => o.ref.week)).toEqual([16]);
  });

  // Two current options at once read as a contradiction rather than as a phase
  // distinction: the dropdown once said Preseason 2 and Week 1 were both
  // current. It is an invariant, so it is tested as one — including at the edges
  // that the old forward-only clamp got wrong (see the case below).
  it("marks exactly one week current, whatever the input", () => {
    const inputs = [
      { currentWeek: 1, practice: { weeks: [1, 2, 3], currentWeek: 2 } },
      { currentWeek: 4, practice: null },
      { currentWeek: 1, practice: { weeks: [], currentWeek: 1 } },
      { currentWeek: 0 },
      { currentWeek: 99 },
    ];
    for (const input of inputs) {
      expect(weekStripOptions(input).filter((o) => o.isCurrent)).toHaveLength(1);
    }
  });

  // Regression: the list this replaced clamped the loop's START to the season
  // but compared the marker against the RAW currentWeek, so an out-of-range
  // week produced a list with nothing marked at all. The strip does not clamp a
  // range any more — only the marker — which is what makes the invariant above
  // hold for the first time.
  it("clamps the current marker into the season", () => {
    const low = weekStripOptions({ currentWeek: 0 }).find((o) => o.isCurrent);
    expect(low!.ref).toEqual({ seasonType: "regular", week: 1 });
    const high = weekStripOptions({ currentWeek: 99 }).find((o) => o.isCurrent);
    expect(high!.ref).toEqual({ seasonType: "regular", week: FINAL_WEEK });
  });

  // This is the Week 1 reset, seen from the UI: practice goes null and the
  // preseason chips vanish. Nothing is deleted and no migration runs.
  it("drops the preseason chips entirely once practice is over", () => {
    const options = weekStripOptions({ currentWeek: 4, practice: null });
    expect(options).toHaveLength(FINAL_WEEK);
    expect(options[0]!.ref).toEqual({ seasonType: "regular", week: 1 });
    // And the marker comes back to the regular season with the chips gone.
    expect(options.filter((o) => o.isCurrent).map((o) => o.ref.week)).toEqual([4]);
  });

  it("ignores an empty practice slate", () => {
    const options = weekStripOptions({ currentWeek: 1, practice: { weeks: [], currentWeek: 1 } });
    expect(options).toHaveLength(FINAL_WEEK);
    expect(options[0]!.ref).toEqual({ seasonType: "regular", week: 1 });
  });

  // What a 50px square actually prints. Zero-padded so a row of fixed-width
  // chips doesn't read ragged, and short-form for the preseason, which is the
  // only thing distinguishing the two phases now that they share one flat list.
  it("pads regular chip labels and shortens preseason ones", () => {
    const options = weekStripOptions({
      currentWeek: 1,
      practice: { weeks: [1, 2, 3, 4], currentWeek: 1 },
    });
    expect(options.slice(0, 4).map((o) => o.chipLabel)).toEqual(["HOF", "P1", "P2", "P3"]);
    expect(options[4]!.chipLabel).toBe("01");
    expect(options.at(-1)!.chipLabel).toBe("18");
  });

  // Mattered less when the two phases lived in separate groups; now they are one
  // array feeding one Map and one React key list, so the pre:1 / regular:1
  // collision that WeekRef exists to prevent deserves a guard at this level too.
  it("keys every option uniquely across both phases", () => {
    const options = weekStripOptions({
      currentWeek: 1,
      practice: { weeks: [1, 2, 3], currentWeek: 1 },
    });
    expect(new Set(options.map((o) => o.key)).size).toBe(options.length);
  });
});

describe("weekShortName", () => {
  // The sticky pick bar's eyebrow — "YOUR WK6 PICK". Only the regular season
  // takes the prefix.
  it("prefixes a regular-season week", () => {
    expect(weekShortName(REGULAR_WEEK(1))).toBe("WK1");
    expect(weekShortName(REGULAR_WEEK(18))).toBe("WK18");
  });

  // Reuses weekShortLabel outright, so the eyebrow says what the week strip's
  // chip already says rather than inventing a second abbreviation.
  it("takes the strip's own preseason abbreviations", () => {
    expect(weekShortName(PRE_WEEK(1), { maxPreWeek: 4 })).toBe("HOF");
    expect(weekShortName(PRE_WEEK(3), { maxPreWeek: 4 })).toBe("P2");
    expect(weekShortName(PRE_WEEK(1), { maxPreWeek: 3 })).toBe("P1");
  });

  // "Wild Card" has no shorter form anyone would recognise, and the bare "1"
  // weekShortLabel returns for it would read as "YOUR 1 PICK".
  it("keeps the postseason's full name", () => {
    expect(weekShortName({ seasonType: "post", week: 1 })).toBe("Wild Card");
  });

  // The property that matters for the eyebrow: never a bare number, for any
  // week this app can reach.
  it("never returns a bare number", () => {
    const refs = [
      ...[1, 6, 18].map(REGULAR_WEEK),
      ...[1, 2, 4].map(PRE_WEEK),
      { seasonType: "post" as const, week: 5 },
    ];
    for (const ref of refs) {
      expect(weekShortName(ref, { maxPreWeek: 4 })).not.toMatch(/^\d+$/);
    }
  });
});

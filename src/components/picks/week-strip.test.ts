import { describe, expect, it } from "vitest";
import { buildChipPicks, chipName, nextIndex, scrollLeftFor } from "./week-strip";
import { PRE_WEEK, REGULAR_WEEK, weekKey, type WeekOption, type WeekRef } from "../../lib/nfl/calendar";
import type { Game, TeamId } from "../../lib/nfl/types";
import type { GroupRules } from "../../lib/league/types";

// A strip of 50px chips with a 1px gap, ten of them, in a 200px window.
const chip = (i: number) => ({ itemStart: i * 51, itemWidth: 50 });
const strip = { viewWidth: 200, contentWidth: 510 };

describe("scrollLeftFor", () => {
  describe("center", () => {
    it("puts the chip's midpoint on the viewport's midpoint", () => {
      // chip 5 spans 255..305, midpoint 280; a 200px window centred there
      // starts at 180.
      expect(
        scrollLeftFor({ ...strip, ...chip(5), scrollLeft: 0, align: "center" }),
      ).toBe(180);
    });

    // The first and last chips have no content past the edge to fill the other
    // half of the window, so they settle flush. Without the clamp the scroller
    // is asked for a negative offset, and a smooth scroll visibly over-travels
    // and springs back.
    it("clamps at both extremes rather than over-travelling", () => {
      expect(scrollLeftFor({ ...strip, ...chip(0), scrollLeft: 0, align: "center" })).toBe(0);
      expect(scrollLeftFor({ ...strip, ...chip(9), scrollLeft: 0, align: "center" })).toBe(310);
    });

    it("stays put when the content fits the window", () => {
      expect(
        scrollLeftFor({
          viewWidth: 600,
          contentWidth: 510,
          ...chip(9),
          scrollLeft: 0,
          align: "center",
        }),
      ).toBe(0);
    });
  });

  describe("nearest", () => {
    // The reason this alignment exists: centring on every tap would slide the
    // strip out from under the finger that just tapped it.
    it("leaves a fully visible chip alone", () => {
      expect(
        scrollLeftFor({ ...strip, ...chip(2), scrollLeft: 100, align: "nearest" }),
      ).toBe(100);
    });

    it("moves the minimum amount when the chip is cut off on the left", () => {
      // chip 1 starts at 51, the window starts at 100.
      expect(
        scrollLeftFor({ ...strip, ...chip(1), scrollLeft: 100, align: "nearest" }),
      ).toBe(51);
    });

    it("moves the minimum amount when the chip is cut off on the right", () => {
      // chip 6 ends at 356; a 200px window ending there starts at 156.
      expect(
        scrollLeftFor({ ...strip, ...chip(6), scrollLeft: 100, align: "nearest" }),
      ).toBe(156);
    });

    it("still clamps into the scrollable range", () => {
      expect(
        scrollLeftFor({ ...strip, ...chip(9), scrollLeft: 500, align: "nearest" }),
      ).toBe(310);
    });
  });
});

describe("nextIndex", () => {
  it("steps one chip at a time", () => {
    expect(nextIndex(4, "ArrowRight", 10)).toBe(5);
    expect(nextIndex(4, "ArrowLeft", 10)).toBe(3);
  });

  // Not a wrap: arrowing off Week 1 onto Week 18 would fling the scroller the
  // whole way across, which reads as a glitch rather than as navigation.
  it("clamps at the ends instead of wrapping", () => {
    expect(nextIndex(0, "ArrowLeft", 10)).toBe(0);
    expect(nextIndex(9, "ArrowRight", 10)).toBe(9);
  });

  it("jumps to the ends", () => {
    expect(nextIndex(4, "Home", 10)).toBe(0);
    expect(nextIndex(4, "End", 10)).toBe(9);
  });

  // null is the signal not to preventDefault, so Tab still leaves the strip and
  // Up/Down still scroll the page.
  it("declines keys that aren't its own", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "a"]) {
      expect(nextIndex(4, key, 10)).toBeNull();
    }
  });

  it("declines an empty strip", () => {
    expect(nextIndex(0, "ArrowRight", 0)).toBeNull();
  });

  // The selection can drop out from under the strip — `practice` going null
  // retires every "pre:N" option while one is still selected.
  it("starts from the top when the current index is out of range", () => {
    expect(nextIndex(-1, "ArrowRight", 10)).toBe(1);
    expect(nextIndex(99, "ArrowLeft", 10)).toBe(0);
  });
});

// --- buildChipPicks / chipName -------------------------------------------

const PUSH_RULES: GroupRules = { eliminationType: "single", tieRule: "push" };
const TIE_IS_LOSS: GroupRules = { ...PUSH_RULES, tieRule: "loss" };

/** A regular-season option, as `weekStripOptions` would build it. */
function opt(ref: WeekRef, isCurrent = false): WeekOption {
  return {
    ref,
    key: weekKey(ref),
    label: ref.seasonType === "pre" ? `Preseason ${ref.week}` : `Week ${ref.week}`,
    chipLabel: ref.seasonType === "pre" ? `P${ref.week}` : String(ref.week).padStart(2, "0"),
    isCurrent,
  };
}

function game(over: Partial<Game> & Pick<Game, "home" | "away">): Game {
  return {
    id: `${over.home}-${over.away}`,
    season: 2026,
    seasonType: "regular",
    week: 1,
    kickoff: "2026-09-13T17:00:00Z",
    status: "final",
    homeScore: 24,
    awayScore: 17,
    ...over,
  };
}

/** The two closures the real call site builds out of `pickForWeek` and a GameIndex. */
function build(
  picks: Record<string, TeamId>,
  games: Record<string, Game | null>,
  rules: GroupRules = PUSH_RULES,
  options: WeekOption[] = [opt(REGULAR_WEEK(1)), opt(REGULAR_WEEK(2)), opt(REGULAR_WEEK(3))],
) {
  return buildChipPicks({
    options,
    pickFor: (ref) => picks[weekKey(ref)] ?? null,
    gameFor: (ref) => games[weekKey(ref)] ?? null,
    rules,
  });
}

describe("buildChipPicks", () => {
  // The component branches on the key being absent, not on a null team.
  it("gives a week with no pick no entry at all", () => {
    const picks = build({}, {});
    expect(picks.size).toBe(0);
    expect(picks.has(weekKey(REGULAR_WEEK(1)))).toBe(false);
  });

  it("reads a final game as a win or a loss", () => {
    const picks = build(
      { "regular:1": "kc", "regular:2": "phi" },
      {
        "regular:1": game({ home: "kc", away: "buf", homeScore: 27, awayScore: 20 }),
        "regular:2": game({ home: "dal", away: "phi", homeScore: 31, awayScore: 14 }),
      },
    );
    expect(picks.get("regular:1")).toEqual({ teamId: "kc", outcome: "win" });
    expect(picks.get("regular:2")).toEqual({ teamId: "phi", outcome: "loss" });
  });

  // The case Member.history structurally cannot answer: the current week is
  // never in it, so a history-driven chip would stay grey through Monday night.
  it("leaves a game that is under way undecided, scores on the board or not", () => {
    const picks = build(
      { "regular:1": "kc" },
      {
        "regular:1": game({
          home: "kc",
          away: "buf",
          status: "in_progress",
          homeScore: 21,
          awayScore: 3,
        }),
      },
    );
    expect(picks.get("regular:1")).toEqual({ teamId: "kc", outcome: "undecided" });
  });

  // The admin's tie rule decides this, and evaluateTeamPick has already applied
  // it — a push is a week you got through, so it takes the same ink as a win.
  it("takes the league's tie rule for a tie", () => {
    const tie = { "regular:1": game({ home: "kc", away: "buf", homeScore: 17, awayScore: 17 }) };
    expect(build({ "regular:1": "kc" }, tie, PUSH_RULES).get("regular:1")?.outcome).toBe("win");
    expect(build({ "regular:1": "kc" }, tie, TIE_IS_LOSS).get("regular:1")?.outcome).toBe("loss");
  });

  // A bye, or a schedule that has not been loaded, must never paint a red chip.
  it("leaves a week with no game undecided rather than lost", () => {
    const picks = build({ "regular:1": "kc" }, { "regular:1": null });
    expect(picks.get("regular:1")).toEqual({ teamId: "kc", outcome: "undecided" });
  });

  // buildGameIndex keys on the week NUMBER alone, which is why MyPicksClient
  // keeps two of them. Route on seasonType and preseason week 3 resolves against
  // the preseason schedule; route on the viewed week and every chip of the other
  // phase paints confident green and red from the wrong games.
  it("resolves each chip against its own phase", () => {
    const picks = build(
      { "pre:3": "kc", "regular:3": "kc" },
      { "pre:3": game({ home: "kc", away: "buf", seasonType: "pre", week: 3 }), "regular:3": null },
      PUSH_RULES,
      [opt(PRE_WEEK(3)), opt(REGULAR_WEEK(3))],
    );
    expect(picks.get("pre:3")?.outcome).toBe("win");
    expect(picks.get("regular:3")?.outcome).toBe("undecided");
  });

  // practiceIdx is null when no preseason schedule is loaded; the call site
  // turns that into a null game rather than throwing.
  it("survives a phase with no schedule at all", () => {
    const picks = build({ "pre:1": "kc", "pre:2": "phi" }, {}, PUSH_RULES, [
      opt(PRE_WEEK(1)),
      opt(PRE_WEEK(2)),
    ]);
    expect([...picks.values()].every((p) => p.outcome === "undecided")).toBe(true);
  });
});

describe("chipName", () => {
  it("names the week, and the team when one was picked", () => {
    expect(chipName(opt(REGULAR_WEEK(3)), null)).toBe("Week 3");
    expect(chipName(opt(REGULAR_WEEK(3)), "Kansas City Chiefs", "undecided")).toBe(
      "Week 3, picked Kansas City Chiefs",
    );
  });

  // Colour is the only visual carrier of the outcome, so it has to be spoken —
  // but only when there is one to speak.
  it("speaks a decided outcome, and stays quiet on an undecided one", () => {
    expect(chipName(opt(REGULAR_WEEK(3)), "Kansas City Chiefs", "win")).toBe(
      "Week 3, picked Kansas City Chiefs, won",
    );
    expect(chipName(opt(REGULAR_WEEK(3)), "Kansas City Chiefs", "loss")).toBe(
      "Week 3, picked Kansas City Chiefs, lost",
    );
  });

  // A Monday-night current week can carry a decided outcome, so the two are not
  // exclusive and their order is fixed rather than incidental.
  it("keeps the current-week marker last", () => {
    expect(chipName(opt(REGULAR_WEEK(3), true), "Kansas City Chiefs", "win")).toBe(
      "Week 3, picked Kansas City Chiefs, won, current week",
    );
  });
});

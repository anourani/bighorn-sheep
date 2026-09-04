import { describe, expect, it } from "vitest";
import {
  clampStep,
  TOUR_STEP_COUNT,
  TOUR_STEPS,
  tourView,
  type TourArtKind,
} from "./tour-steps";

const CTA = "Make my pick";

describe("the deck", () => {
  it("is seven steps", () => {
    expect(TOUR_STEP_COUNT).toBe(7);
    expect(TOUR_STEPS).toHaveLength(7);
  });

  it("runs the three tabs first, then the four rules", () => {
    expect(TOUR_STEPS.map((s) => s.art)).toEqual<TourArtKind[]>([
      "tabs",
      "tabs",
      "tabs",
      "card",
      "strip",
      "lock",
      "board",
    ]);
  });

  it("lights each nav tab exactly once, in order, and only on the tabs steps", () => {
    expect(TOUR_STEPS.map((s) => s.tab)).toEqual([
      0,
      1,
      2,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  /**
   * The copy is the product here, not an implementation detail — it is the only
   * place the app ever explains the rules that eliminate people. A silent edit
   * to any of it should fail.
   */
  it("carries the design's warm copy verbatim", () => {
    expect(TOUR_STEPS.map((s) => s.title)).toEqual([
      "Picks — this screen",
      "Standings — the board",
      "Account — your league",
      "Tap a team to pick it",
      "One team, once a season",
      "Locks at its own kickoff",
      "Picks are hidden until kickoff",
    ]);
    expect(TOUR_STEPS.map((s) => s.body)).toEqual([
      "Make your pick here each week. That's the whole job.",
      "Fills in as picks reveal. Track who's still alive.",
      "League, timezone, and this tour if you need it again.",
      "One team a week. They win, you survive to the next one.",
      "The team you pick shows right on its week in the week selector, so you can always see what you've used.",
      "A Thursday team locks Thursday. Change your pick freely until then.",
      "You can't see anyone else's team until its game starts.",
    ]);
  });

  /**
   * The PRD's step-7 acceptance criterion, pinned: the title is exactly this,
   * and it says nothing about who wins the season.
   */
  it("titles the last step without promising an outcome", () => {
    // Through `tourView` rather than `TOUR_STEPS[6]`: `noUncheckedIndexedAccess`
    // makes a literal index into the tuple `TourStep | undefined` past element
    // 0, and the accessor is the thing worth testing anyway.
    const last = tourView(TOUR_STEP_COUNT - 1, CTA).step;
    expect(last.title).toBe("Picks are hidden until kickoff");
    expect(last.title).not.toMatch(/win|won|champion/i);
  });
});

describe("clampStep", () => {
  it("holds an index inside the deck", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(0)).toBe(0);
    expect(clampStep(6)).toBe(6);
    expect(clampStep(99)).toBe(6);
  });

  it("resolves a non-integer or NaN to the first step rather than propagating", () => {
    expect(clampStep(2.7)).toBe(2);
    expect(clampStep(Number.NaN)).toBe(0);
    expect(clampStep(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("tourView", () => {
  it("counts from 01 and pads both halves", () => {
    expect(tourView(0, CTA).counter).toBe("01 / 07");
    expect(tourView(6, CTA).counter).toBe("07 / 07");
  });

  it("lights exactly one dot, at the current step", () => {
    for (let i = 0; i < TOUR_STEP_COUNT; i += 1) {
      const { dots } = tourView(i, CTA);
      expect(dots).toHaveLength(TOUR_STEP_COUNT);
      expect(dots.filter(Boolean)).toHaveLength(1);
      expect(dots[i]).toBe(true);
    }
  });

  /**
   * The handoff is the whole point of the last card, and the label is the
   * caller's — the tour says "Make my pick", the account page's replay says
   * "Back to Account". Getting this wrong sends someone to the wrong place.
   */
  it("reads Next until the last step, then the caller's CTA", () => {
    for (let i = 0; i < 6; i += 1) {
      expect(tourView(i, CTA).nextLabel).toBe("Next");
    }
    expect(tourView(6, CTA).nextLabel).toBe(CTA);
    expect(tourView(6, "Back to Account").nextLabel).toBe("Back to Account");
  });

  it("softens Skip to 'Not now' only on the last step", () => {
    for (let i = 0; i < 6; i += 1) {
      expect(tourView(i, CTA).skipLabel).toBe("Skip");
    }
    expect(tourView(6, CTA).skipLabel).toBe("Not now");
  });

  it("offers Back everywhere except the first step", () => {
    expect(tourView(0, CTA).canBack).toBe(false);
    for (let i = 1; i < TOUR_STEP_COUNT; i += 1) {
      expect(tourView(i, CTA).canBack).toBe(true);
    }
  });

  it("flags the last step once, at the end", () => {
    expect(TOUR_STEPS.map((_, i) => tourView(i, CTA).isLast)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("clamps rather than returning an undefined step", () => {
    expect(tourView(99, CTA).step).toBe(TOUR_STEPS[6]);
    expect(tourView(-1, CTA).step).toBe(TOUR_STEPS[0]);
  });
});

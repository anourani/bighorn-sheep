import { describe, expect, it } from "vitest";
import {
  bodyText,
  clampStep,
  spokenBodyText,
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

  /**
   * Page, then that page's details, then the next page. The prototype ran all
   * three nav cards first and all four detail cards after, which left "Hidden
   * Picks" — an illustration of the standings board — five cards away from the
   * card introducing the standings board.
   */
  it("introduces a page, then teaches it, before moving on", () => {
    expect(TOUR_STEPS.map((s) => s.art)).toEqual<TourArtKind[]>([
      "tabs",
      "strip",
      "card",
      "lock",
      "tabs",
      "board",
      "tabs",
    ]);
  });

  it("lights each nav tab exactly once, in order, and only on the tabs steps", () => {
    expect(TOUR_STEPS.map((s) => s.tab)).toEqual([
      0,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      2,
    ]);
  });

  /**
   * Each detail card must sit under the nav card for the page it belongs to,
   * which is the whole premise of the order above. Asserted as "every non-tabs
   * step names the tab most recently lit", so a reshuffle that separates a
   * detail from its page fails rather than merely looking odd.
   */
  it("keeps every detail card under the page it belongs to", () => {
    const owner: Array<0 | 1 | 2> = [];
    let current: 0 | 1 | 2 = 0;
    for (const step of TOUR_STEPS) {
      if (step.art === "tabs") current = step.tab ?? 0;
      else owner.push(current);
    }
    // Week selector, matchup card and lock timer all live on Picks; the hidden
    // pill lives on Standings. Nothing hangs off Account.
    expect(owner).toEqual([0, 0, 0, 1]);
  });

  /**
   * The copy is the product here, not an implementation detail — it is the only
   * place the app ever explains the rules that eliminate people. A silent edit
   * to any of it should fail.
   */
  it("carries the shipped copy verbatim", () => {
    expect(TOUR_STEPS.map((s) => s.title)).toEqual([
      "The Picks Page",
      "The Week Selector",
      "Making Your Pick",
      "The Lock Timer",
      "The Standings Page",
      "Hidden Picks",
      "The Account Page",
    ]);
    expect(TOUR_STEPS.map((s) => bodyText(s.body))).toEqual([
      "This is where you pick your team each week. Tap the week you want, then tap a team. That's it.",
      "Weeks act like tabs. Tap one and that week's teams appear below. Weeks you've already picked show their team.",
      "Select the team you know think is going to win. Remember, you can't pick the same team twice so choose wisely!",
      "The team you pick is locked the moment their game starts. You can change your pick any time before that.",
      "This is the league scoreboard. See what teams everyone else picked, who's in and who's out.",
      'Everybody\'s pick on the Standings page will read as "Hidden" until that team is locked in.',
      "This is where you go for all things account related. Update your account info and pay your buy-in dues!",
    ]);
  });

  /**
   * The PRD's acceptance criterion for the hidden-picks card: it explains the
   * reveal and says nothing about who wins the season. It is no longer the LAST
   * card — the reorder moved it under Standings, where it belongs — so this
   * finds it by its art rather than by position.
   */
  it("explains the reveal without promising an outcome", () => {
    const hidden = TOUR_STEPS.find((s) => s.art === "board");
    expect(hidden?.title).toBe("Hidden Picks");
    expect(bodyText(hidden?.body ?? "")).not.toMatch(/win|won|champion/i);
  });

  /**
   * The one segmented body in the deck, and both of its readings.
   *
   * The joke is visual: struck through, "the team you know think is going to
   * win" reads as a correction. Read aloud it is simply a broken sentence, so
   * the drawn text keeps "know" and the spoken text drops it. This pins the
   * pair — a segment that lost its `strike` flag would still render plausibly
   * while quietly making the sentence ungrammatical for anyone using a screen
   * reader, which is exactly the kind of thing nobody notices.
   */
  it("strikes one word visually and drops it from the spoken reading", () => {
    const pick = TOUR_STEPS.find((s) => s.title === "Making Your Pick");
    expect(Array.isArray(pick?.body)).toBe(true);
    expect(bodyText(pick?.body ?? "")).toContain("you know think is going to win");
    expect(spokenBodyText(pick?.body ?? "")).toContain("you think is going to win");
    expect(spokenBodyText(pick?.body ?? "")).not.toContain("know");
  });

  /** Every other body stays a plain string — no single-element arrays for symmetry. */
  it("leaves every unstruck body a plain string", () => {
    expect(TOUR_STEPS.filter((s) => typeof s.body !== "string")).toHaveLength(1);
  });

  /**
   * Two claims the copy must not make, both of which the design's prototype
   * made and neither of which is true of this app.
   *
   * The mock-up's account screen listed a TIMEZONE setting, and the prototype's
   * step 3 promised one. There has never been a timezone control anywhere in
   * `components/account/` — the tour would have sent a new player hunting for a
   * row that does not exist.
   *
   * And a TIE does not eliminate you: `tie_rule` defaults to `push` in 0001, so
   * a tie survives, and only a league that has opted into `loss` behaves the way
   * the landing page's pitch describes. This deck is shown to every league, so
   * it must not state the rule either way.
   */
  /**
   * No em dashes in anything a player reads.
   *
   * The prototype used them freely and they are all over this repo's prose, but
   * the tour is product copy: at 15px in a 72px box an em dash reads as a pause
   * the reader has to parse, where a full stop just ends the sentence. Titles
   * never had one; step 1's body did, and this is what stops the next edit
   * reintroducing it. En and figure dashes are caught too, since they are the
   * characters a well-meaning find-and-replace reaches for next.
   */
  it("keeps typographic dashes out of the copy", () => {
    for (const step of TOUR_STEPS) {
      expect(`${step.title} ${bodyText(step.body)}`).not.toMatch(/[\u2012-\u2015]/);
    }
  });

  it("promises nothing the app does not actually do", () => {
    const copy = TOUR_STEPS.map((s) => `${s.title} ${bodyText(s.body)}`)
      .join(" ")
      .toLowerCase();
    expect(copy).not.toContain("timezone");
    expect(copy).not.toContain("time zone");
    // Word-bounded: a bare substring would fire on "entities" or "properties".
    expect(copy).not.toMatch(/\bties?\b/);
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

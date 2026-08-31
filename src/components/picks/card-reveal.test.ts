import { describe, expect, it } from "vitest";
import {
  FADE_BLUR_PX,
  FADE_DURATION,
  FADE_HIDDEN_FILTER,
  FADE_OUT_DURATION,
  FADE_SCALE,
  FADE_SHOWN_FILTER,
  REPLAY_IN_DURATION,
  REPLAY_OUT_DURATION,
  REVEAL_CLIP,
  REVEAL_DURATION,
  REVEAL_FADE,
  REVEAL_STEP,
  columnCountFrom,
  countColumnsByRow,
  planCardReveal,
  revealDelay,
} from "./card-reveal";
import { HERO_DURATION_MS } from "../ui/blur-reveal";
import tailwind from "../../../tailwind.config";

// What `getComputedStyle(grid).gridTemplateColumns` actually returns: a list of
// USED pixel lengths, one per track. These are the four widths TeamGrid draws
// (`grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`) and the
// two WeekSchedule's `repeat(auto-fill, minmax(260px,1fr))` resolves to inside
// the desktop column.
const used = (n: number, px: number) => Array.from({ length: n }, () => `${px}px`).join(" ");

describe("columnCountFrom", () => {
  it("counts the used track list at each width the team grid steps through", () => {
    expect(columnCountFrom(used(3, 125.66))).toBe(3); // phone
    expect(columnCountFrom(used(4, 116.5))).toBe(4); // min-[480px]
    expect(columnCountFrom(used(5, 148.8))).toBe(5); // md
    expect(columnCountFrom(used(6, 160))).toBe(6); // lg
  });

  it("counts an auto-fill grid's RESOLVED tracks, which is why this reads the used value", () => {
    // The matchup grid's count is content-driven rather than breakpoint-driven,
    // so nothing about the authored track definition predicts it.
    expect(columnCountFrom(used(1, 361))).toBe(1);
    expect(columnCountFrom(used(3, 316))).toBe(3);
  });

  // A value that can't be counted must answer 0 so the caller can fall back to
  // "reveal the row together". Answering a wrong number instead would be worse:
  // the caller has no way to tell a real 2 from a misparsed one.
  it("refuses an unresolved repeat() rather than miscounting its comma as a track", () => {
    // An element that isn't laid out hands back the SPECIFIED value. Split on
    // whitespace this looks like two tracks — "repeat(auto-fill," and
    // "minmax(260px," and "1fr))" — which is a plausible-looking lie.
    expect(columnCountFrom("repeat(auto-fill, minmax(260px, 1fr))")).toBe(0);
    expect(columnCountFrom("repeat(3, 1fr)")).toBe(0);
  });

  it("answers 0 for a grid that isn't one", () => {
    expect(columnCountFrom("none")).toBe(0);
    expect(columnCountFrom("")).toBe(0);
    expect(columnCountFrom("   ")).toBe(0);
  });

  it("strips line names, which sit between the tracks and are not tracks", () => {
    expect(columnCountFrom("[full-start] 100px [main-start] 200px [main-end]")).toBe(2);
    expect(columnCountFrom("[a] 100px [b]")).toBe(1);
  });

  it("counts a single zero-width track as one track", () => {
    // An empty grid still has its columns; it must not read as "unreadable".
    expect(columnCountFrom("0px")).toBe(1);
  });
});

describe("countColumnsByRow", () => {
  it("counts the cards sharing the first row's top edge", () => {
    expect(countColumnsByRow([120, 120, 120, 268, 268, 268])).toBe(3);
  });

  // Real track widths do not divide evenly, so a genuine row measures as
  // 120.656 / 120.672 / 120.656 rather than three identical numbers.
  it("absorbs the sub-pixel rounding a real grid actually reports", () => {
    expect(countColumnsByRow([120.656, 120.672, 120.656, 268.4])).toBe(3);
  });

  // The first row ends where the run ends. Counting every matching top instead
  // would fold a later row that happens to land on the same coordinate — which
  // it can, once the page has scrolled — into the first one.
  it("stops at the end of the first row rather than counting every matching top", () => {
    expect(countColumnsByRow([120, 120, 268, 120])).toBe(2);
  });

  it("answers 1 rather than 0 for a single card or none at all", () => {
    // 0 would make `index % columns` NaN, which does not throw — it silently
    // deletes the stagger.
    expect(countColumnsByRow([120])).toBe(1);
    expect(countColumnsByRow([])).toBe(1);
  });

  // This is the pairing that actually runs on the matchup layout, whose
  // fieldset reports its specified `repeat(auto-fill, ...)` at every width.
  it("picks up exactly where columnCountFrom declines", () => {
    expect(columnCountFrom("repeat(auto-fill, minmax(260px, 1fr))")).toBe(0);
    expect(countColumnsByRow([1695, 1828, 1960])).toBe(1); // phone
    expect(countColumnsByRow([1420, 1420, 1420, 1553])).toBe(3); // desktop
  });
});

describe("revealDelay", () => {
  it("cascades left to right across a row", () => {
    expect(revealDelay(0, 6)).toBe(0);
    expect(revealDelay(1, 6)).toBe(0.1);
    expect(revealDelay(5, 6)).toBe(0.5);
  });

  // The whole reason for the modulus. Cards in a row cross the trigger line at
  // the same scroll moment, so the cascade has to come from the delay — and it
  // has to RESET, or the delay grows down the grid until a card on screen is
  // still waiting seconds later.
  it("resets at the start of every row rather than growing down the grid", () => {
    expect(revealDelay(3, 3)).toBe(0); // first card of row 2
    expect(revealDelay(4, 3)).toBe(0.1);
    expect(revealDelay(31, 6)).toBe(0.1); // last of 32 at lg, not 3.1s
  });

  it("keeps a row's whole cascade to one step per column", () => {
    for (const cols of [1, 3, 4, 5, 6]) {
      const row = Array.from({ length: cols }, (_, i) => revealDelay(i, cols));
      expect(Math.max(...row)).toBeCloseTo((cols - 1) * REVEAL_STEP, 10);
    }
  });

  // columnCountFrom answers 0 when it can't read the grid; that must degrade to
  // "the row reveals together", never to NaN or a division by zero.
  it("floors an unreadable column count at one instead of dividing by zero", () => {
    expect(revealDelay(7, 0)).toBe(0);
    expect(revealDelay(7, -4)).toBe(0);
  });

  it("does not hand a negative index back as a negative delay", () => {
    expect(revealDelay(-1, 6)).toBe(0);
  });

  it("returns a clean number, because 3 * 0.1 is not 0.3 in binary floating point", () => {
    expect(revealDelay(3, 6)).toBe(0.3);
    expect(revealDelay(7, 8)).toBe(0.7);
  });
});

describe("planCardReveal", () => {
  const plan = (weekChanged: boolean, wasRevealed: boolean, aboveLine: boolean) =>
    planCardReveal({ weekChanged, wasRevealed, aboveLine });

  // The whole eight-row table, because the rules read as three overlapping
  // conditions and it is the overlaps that were wrong before.
  describe("a week change — the one thing that animates a card twice", () => {
    it("replays a revealed card on screen, wiping it away before wiping it back", () => {
      expect(plan(true, true, true)).toEqual({ kind: "replay", wipeOut: true });
    });

    // WeekSchedule keys its cards on `game.id`, which is globally unique per
    // game, so a week change unmounts every one of them. A card mounted a
    // moment ago is already masked and has nothing to wipe away.
    it("replays a freshly mounted card on screen without a wipe-away", () => {
      expect(plan(true, false, true)).toEqual({ kind: "replay", wipeOut: false });
    });

    // Out of sight, so there is nothing to animate. It gets the ordinary scroll
    // reveal on the way down, exactly as on a fresh load.
    it("arms anything below the line rather than animating it unseen", () => {
      expect(plan(true, true, false)).toEqual({ kind: "arm" });
      expect(plan(true, false, false)).toEqual({ kind: "arm" });
    });
  });

  describe("any other rebuild — a sort toggle, a breakpoint crossing", () => {
    // This is the bug the position test used to cause: with a one-way reveal,
    // a card revealed on the way down and then scrolled back below the line is
    // STILL revealed, and re-masking it on the next sort toggle would make it
    // vanish. Revealed-ness is the only thing that can answer here.
    it("holds a revealed card wherever it now sits on the page", () => {
      expect(plan(false, true, true)).toEqual({ kind: "hold" });
      expect(plan(false, true, false)).toEqual({ kind: "hold" });
    });

    it("arms a card that has never revealed, wherever it sits", () => {
      expect(plan(false, false, true)).toEqual({ kind: "arm" });
      expect(plan(false, false, false)).toEqual({ kind: "arm" });
    });
  });

  it("never holds on a week change, which is what stranded the first row before", () => {
    // The first row is revealed and above the line — the exact combination that
    // used to be snapped to the end instead of played.
    expect(plan(true, true, true).kind).not.toBe("hold");
  });
});

describe("the reveal durations", () => {
  it("makes the week-change round trip quicker than a first reveal", () => {
    // A first reveal introduces the grid; a replay only says the week turned
    // over, and a card that lingers as long the second time reads as sluggish.
    expect(REPLAY_OUT_DURATION + REPLAY_IN_DURATION).toBeLessThan(REVEAL_DURATION * 2);
    expect(REPLAY_IN_DURATION).toBeLessThan(REVEAL_DURATION);
  });

  it("keeps the exit shorter than the entrance, as Drawer does", () => {
    expect(REPLAY_OUT_DURATION).toBeLessThan(REPLAY_IN_DURATION);
  });

  // Whichever reveal a surface takes, a card has to start while the one to its
  // left is still travelling — that overlap is what makes a row read as one
  // wave rather than a queue. The fade is the tighter of the two at 0.65s
  // against a 0.3s worst-case row span, so this is not slack.
  it("steps a row faster than either reveal takes, so the cards overlap", () => {
    expect(REVEAL_STEP).toBeLessThan(REVEAL_DURATION);
    expect(REVEAL_STEP).toBeLessThan(FADE_DURATION);
  });

  it("runs the fade at the pick module's pace, not the wipe's", () => {
    // Pinned as a VALUE, not as `FADE_DURATION * 1000 === HERO_DURATION_MS` —
    // that is how it is derived, so asserting it proves nothing. This is what
    // makes a change to the hero's pace surface here, where the matchup cards
    // are the other thing it silently re-times.
    expect(FADE_DURATION).toBe(0.65);
    expect(HERO_DURATION_MS).toBe(650);
    expect(FADE_OUT_DURATION).toBeLessThan(FADE_DURATION);
  });
});

describe("the two reveals", () => {
  // Both class names are hand-authored rules inside `globals.css`'s
  // `@layer utilities`, which Tailwind tree-shakes against `content` — so each
  // has to survive as a literal somewhere under `src/`, and these constants are
  // the only place they appear now that neither component types one. Exactly the
  // coupling `blur-reveal.test.ts` guards for `BLUR_REVEAL_CLASS`. A rename that
  // misses `globals.css` compiles to nothing and renders a blank grid.
  it("names the two classes globals.css defines", () => {
    expect(REVEAL_CLIP.className).toBe("reveal-clip");
    expect(REVEAL_FADE.className).toBe("reveal-fade");
  });

  // `reveal-blur` is a THIRD class in that same layer, and it means the
  // opposite — it switches the hero's animation off under reduced motion.
  // Colliding with it would silently kill that.
  it("keeps the fade's class clear of the hero's reduced-motion marker", () => {
    expect(REVEAL_FADE.className).not.toBe("reveal-blur");
    expect(REVEAL_CLIP.className).not.toBe(REVEAL_FADE.className);
  });

  // The hook queries `:scope > .{className}` and returns early on no match, so a
  // class name with a space in it silently reveals nothing at all.
  it("gives each a single class token, because it goes into a selector", () => {
    for (const reveal of [REVEAL_CLIP, REVEAL_FADE]) {
      expect(reveal.className.split(/\s+/)).toHaveLength(1);
    }
  });

  // Every property the hook animates has to be named at BOTH ends. GSAP reads
  // nothing back off the element for these — `fromTo` is given both states — and
  // a property present in one end only is either left at its CSS start state
  // forever or snapped rather than tweened.
  it("animates between two states naming the same properties", () => {
    expect(Object.keys(REVEAL_CLIP.hidden).sort()).toEqual(Object.keys(REVEAL_CLIP.shown).sort());
    // The fade is the one exception, and it is deliberate: `pointerEvents` is in
    // `shown` alone. `.reveal-fade` sets `none` in CSS and this hands it back —
    // an invisible `opacity: 0` card is still clickable, where a clipped one is
    // not, and a stray tap on one spends a team for the season.
    expect(Object.keys(REVEAL_FADE.shown)).toContain("pointerEvents");
    expect(REVEAL_FADE.shown.pointerEvents).toBe("auto");
    expect(REVEAL_FADE.hidden.pointerEvents).toBeUndefined();
  });

  // THE string test, and the reason it asserts strings rather than the number
  // 12 or the number 0: GSAP has no filter parser. It tweens `filter` as a
  // generic string, measuring the unit off the end value — and `blur(0)` has a
  // `)` in the way, so no unit is ever appended and the midpoint renders
  // `filter: blur(6)`, which is invalid, is dropped by the browser, and leaves
  // the card at `blur(12px)` until the last frame snaps it clear. `none` is
  // worse: no numbers at all means GSAP swaps it in on the FIRST tick.
  //
  // Both spellings look right in review and neither errors. `expect(FADE_BLUR_PX)
  // .toBe(12)` cannot catch either one.
  it("spells the resolved filter with a unit, which is what makes it tween", () => {
    expect(FADE_SHOWN_FILTER).toBe("blur(0px)");
    expect(FADE_HIDDEN_FILTER).toBe("blur(12px)");
    expect(REVEAL_FADE.shown.filter).toBe("blur(0px)");
    expect(REVEAL_FADE.hidden.filter).toBe("blur(12px)");
  });
});

// The loop this closes: the fade exists to match the My Picks hero, but the
// hero's own reveal is a CSS keyframe in `tailwind.config.ts` that nothing at
// runtime can read — so the constants above are a hand copy of it, and a hand
// copy drifts. vitest runs in Node and the config is plain TS with a default
// export, so the copy can simply be checked against the original.
describe("the fade against the blur-in keyframe it mirrors", () => {
  const keyframe = tailwind.theme?.extend?.keyframes?.["blur-in"] as Record<
    string,
    Record<string, string>
  >;
  const token = tailwind.theme?.extend?.animation?.["blur-in"] as string;

  it("starts from the keyframe's own blur and scale", () => {
    expect(keyframe.from.filter).toBe(`blur(${FADE_BLUR_PX}px)`);
    expect(keyframe.from.transform).toBe(`scale(${FADE_SCALE})`);
    expect(keyframe.from.opacity).toBe("0");
  });

  it("resolves to the same place, modulo the unit GSAP needs and CSS does not", () => {
    // The keyframe may say `blur(0)`; GSAP must say `blur(0px)`. Same picture,
    // and the difference is the whole of the test above.
    expect(keyframe.to.filter.replace("blur(0)", "blur(0px)")).toBe(FADE_SHOWN_FILTER);
    expect(keyframe.to.transform).toBe("scale(1)");
  });

  it("eases on the curve the token names, which is why CustomEase is registered", () => {
    // `use-card-reveal.ts` registers this as the SVG cubic
    // `M0,0 C0.16,1 0.3,1 1,1` — a cubic from (0,0) to (1,1) whose control
    // points are the bezier's handles. If the token's curve ever changes, that
    // path has to change with it.
    expect(token).toContain("cubic-bezier(0.16,1,0.3,1)");
  });
});

import { describe, expect, it } from "vitest";
import {
  BLUR_DURATION_MS,
  BLUR_REVEAL_CLASS,
  BLUR_STEP_MS,
  cascadeStarts,
  revealDelay,
  splitWords,
  wordCount,
} from "./blur-reveal";

describe("splitWords", () => {
  it("gives each word its own slot", () => {
    expect(splitWords("Last Man Standing")).toEqual(["Last", "Man", "Standing"]);
  });

  // The matchup line is built as `${home ? "vs." : "@"} ${opp}`, so the
  // punctuation rides along with the word rather than splitting off it.
  it("keeps punctuation attached to its word", () => {
    expect(splitWords("vs. Chiefs")).toEqual(["vs.", "Chiefs"]);
  });

  // `Locks in ${cd.label}` with an empty label used to be the shape that broke
  // this: a plain split(" ") yields an empty string, which renders a span that
  // occupies a cascade slot and animates nothing visible — a gap in the wave.
  it("collapses runs of whitespace rather than emitting empty words", () => {
    expect(splitWords("  Locks  in   ")).toEqual(["Locks", "in"]);
  });

  it("has no words at all in an empty line", () => {
    expect(splitWords("")).toEqual([]);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("revealDelay", () => {
  it("starts the first piece immediately", () => {
    expect(revealDelay(0)).toBe(0);
  });

  it("steps one piece per 40ms, as the spec asks", () => {
    expect(revealDelay(1)).toBe(40);
    expect(revealDelay(7)).toBe(280);
  });
});

describe("cascadeStarts", () => {
  it("hands the first piece index zero and offsets each one by what came before", () => {
    expect(cascadeStarts([4, 1, 1, 2])).toEqual([0, 4, 5, 6]);
  });

  // The whole point of the helper: several separate elements reading as one
  // wave. Landing page — "Welcome to" then "Last Man Standing".
  it("runs two text blocks together as a single five-word cascade", () => {
    expect(cascadeStarts([2, 3])).toEqual([0, 2]);
  });

  // The My Picks hero's real shape: eyebrow, three colour strips, the logo,
  // city, team name, matchup, kickoff date, kickoff time, then two lock lines.
  // The strips and the logo are one slot each — they are not split.
  it("gives the hero's strips and logo a slot each between the eyebrow and the name", () => {
    const counts = [4, 1, 1, 1, 1, 1, 1, 2, 1, 1, 4, 11];
    const at = cascadeStarts(counts);

    expect(at.slice(0, 6)).toEqual([0, 4, 5, 6, 7, 8]);
    // The last line starts once every piece before it has been handed a slot.
    expect(at.at(-1)).toBe(18);
    expect(revealDelay(at.at(-1)!)).toBe(720);
  });

  it("is empty for an empty module", () => {
    expect(cascadeStarts([])).toEqual([]);
  });

  // A block whose text is empty — `NoPickHero`'s cityless branch renders an
  // invisible stand-in rather than a word — takes no slot, so the piece after
  // it does not inherit a hole in the cascade.
  it("skips over a block with nothing in it", () => {
    expect(cascadeStarts([1, 0, 1])).toEqual([0, 1, 1]);
  });
});

describe("the timing constants", () => {
  // The relationship, not the values: at a step shorter than the duration a
  // piece begins while its predecessor is still travelling, which is what makes
  // the module resolve as one wave instead of a queue of separate animations.
  // The same assertion `card-reveal.test.ts` makes about its own two durations.
  it("steps faster than a single piece takes, so the pieces overlap", () => {
    expect(BLUR_STEP_MS).toBeLessThan(BLUR_DURATION_MS);
  });

  // The whole effect is CSS; nothing reads the duration at runtime. If the
  // Tailwind token and this constant drift apart, every comment reasoning about
  // the cascade's length is silently wrong — hence the reminder in the name.
  it("mirrors the duration in the tailwind blur-in token", () => {
    expect(BLUR_DURATION_MS).toBe(1250);
  });

  // `animate-blur-in` must survive as a literal class or Tailwind never emits
  // `@keyframes blur-in`, and every revealed element renders unanimated with no
  // error anywhere. `reveal-blur` is the reduced-motion override's only hook.
  it("carries both the utility and the reduced-motion marker", () => {
    expect(BLUR_REVEAL_CLASS.split(" ")).toEqual(["reveal-blur", "animate-blur-in"]);
  });
});

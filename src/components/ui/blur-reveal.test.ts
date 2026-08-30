import { describe, expect, it } from "vitest";
import {
  BLOCK_GAP_MS,
  BLUR_DURATION_MS,
  BLUR_REVEAL_CLASS,
  BLUR_SETTLE_FRACTION,
  BLUR_STEP_MS,
  blockStarts,
  cascadeStarts,
  HERO_DURATION_MS,
  revealDelay,
  settleMs,
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

  // The spec asked for 40ms. The My Picks hero at 29 pieces then took 2.37s end
  // to end and read as slow, so the step was halved; the hero's own shorter
  // duration and its per-line lock copy were the rest of that fix.
  it("steps one piece per 20ms", () => {
    expect(revealDelay(1)).toBe(20);
    expect(revealDelay(7)).toBe(140);
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
  // The strips, the logo AND each lock line are one slot each — none is split.
  it("gives the hero's strips, logo and lock lines a slot each", () => {
    const counts = [4, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1];
    const at = cascadeStarts(counts);

    expect(at.slice(0, 6)).toEqual([0, 4, 5, 6, 7, 8]);
    // Sixteen pieces in all, so the last one starts on slot 15.
    expect(at.at(-1)).toBe(15);
    expect(revealDelay(at.at(-1)!)).toBe(300);
  });

  // The count that made the module drag: the two lock lines were 4 words and 11
  // words, which is 13 extra slots for one sentence of 12px grey type.
  it("cost 13 extra slots when the lock lines were split into words", () => {
    const perWord = cascadeStarts([4, 1, 1, 1, 1, 1, 1, 2, 1, 1, 4, 11]);
    const perLine = cascadeStarts([4, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1]);

    expect(perWord.at(-1)! - perLine.at(-1)!).toBe(3);
    expect(perWord.at(-1)! + 11 - (perLine.at(-1)! + 1)).toBe(13);
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

describe("settleMs", () => {
  // 700ms of the default 1250ms. The number the home page's whole sequence is
  // built on, and it is not a guess: cubic-bezier(0.16,1,0.3,1) is 98.3% of the
  // way through at t = 0.56, and the frame captured at 700ms while the effect
  // was being built already read as fully resolved.
  it("lands a default-paced piece at 700ms", () => {
    expect(settleMs()).toBe(700);
  });

  it("scales with a surface's own pace", () => {
    expect(settleMs(HERO_DURATION_MS)).toBe(364);
    expect(settleMs(HERO_DURATION_MS)).toBeLessThan(settleMs());
  });

  // The point of the fraction is that it is well inside the animation. Landing
  // at or past the end would make it a synonym for "finished" and the sequence
  // would stretch back out to the 7.7s it was designed to avoid.
  it("lands well before the animation formally ends", () => {
    expect(settleMs()).toBeLessThan(BLUR_DURATION_MS);
    expect(BLUR_SETTLE_FRACTION).toBeGreaterThan(0.5);
    expect(BLUR_SETTLE_FRACTION).toBeLessThan(1);
  });
});

describe("blockStarts", () => {
  // The home page, exactly: a five-word title after a 1s hold, then the
  // description, then the headcount and standings table as ONE block.
  it("sequences the home page's three blocks", () => {
    expect(blockStarts([5, 1, 1], 1000)).toEqual([1000, 2280, 3480]);
  });

  // Splitting the board in two is what the page used to do, and it pushed the
  // last block a further 1.2s out — one settle plus one gap per extra block.
  it("costs a settle and a gap for every block the page is split into", () => {
    const three = blockStarts([5, 1, 1], 1000);
    const four = blockStarts([5, 1, 1, 1], 1000);
    expect(four.at(-1)! - three.at(-1)!).toBe(settleMs() + BLOCK_GAP_MS);
  });

  // Where those numbers come from, spelled out so a change to any constant
  // shows up here rather than only on screen: the title's last word starts at
  // 1000 + 4 steps, lands 700ms later, and the next block waits 500ms more.
  it("waits for the previous block's LAST piece, not its first", () => {
    const [, second] = blockStarts([5, 1], 1000);
    expect(second).toBe(1000 + 4 * BLUR_STEP_MS + settleMs() + BLOCK_GAP_MS);

    // A one-piece block has no internal spread, so it is 1200ms to the next.
    const [, afterSingle] = blockStarts([1, 1], 0);
    expect(afterSingle).toBe(settleMs() + BLOCK_GAP_MS);
  });

  it("starts at zero when nothing is held back", () => {
    expect(blockStarts([1, 1])[0]).toBe(0);
  });

  it("is empty for a page with no blocks", () => {
    expect(blockStarts([], 1000)).toEqual([]);
  });

  // A surface running at its own pace settles sooner, so its blocks tighten up.
  it("tightens the sequence for a faster surface", () => {
    const slow = blockStarts([1, 1], 0);
    const fast = blockStarts([1, 1], 0, HERO_DURATION_MS);
    expect(fast[1]).toBeLessThan(slow[1]!);
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

  // The hero re-forms on every team tap; the landing title is looked at once.
  // The relationship is the point — the values are set by `--blur-ms`, and if
  // they ever crossed, the interactive surface would be the slower of the two.
  it("runs the My Picks hero faster than the default pace", () => {
    expect(HERO_DURATION_MS).toBeLessThan(BLUR_DURATION_MS);
  });
});

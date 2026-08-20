import { describe, expect, it } from "vitest";
import { REVEAL_STEP, columnCountFrom, countColumnsByRow, revealDelay } from "./card-reveal";

// What `getComputedStyle(grid).gridTemplateColumns` actually returns: a list of
// USED pixel lengths, one per track. These are the four widths TeamGrid draws
// (`grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`) and the
// two WeekSchedule's `repeat(auto-fill, minmax(260px,1fr))` resolves to inside
// the 968px column.
const used = (n: number, px: number) => Array.from({ length: n }, () => `${px}px`).join(" ");

describe("columnCountFrom", () => {
  it("counts the used track list at each width the team grid steps through", () => {
    expect(columnCountFrom(used(3, 125.66))).toBe(3); // phone
    expect(columnCountFrom(used(4, 116.5))).toBe(4); // min-[480px]
    expect(columnCountFrom(used(5, 148.8))).toBe(5); // md
    expect(columnCountFrom(used(6, 154.66))).toBe(6); // lg
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

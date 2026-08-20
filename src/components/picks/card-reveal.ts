/**
 * The arithmetic behind the pick surfaces' scroll reveal, kept out of the hook
 * so it unit-tests without a component-test stack — the same split
 * `week-strip.ts` and `team-grid.ts` make, and the repo's standing convention
 * (vitest runs in the Node environment; there is no jsdom and no
 * @testing-library here).
 *
 * The reveal itself is a clip-path mask, not a fade: each card starts fully
 * masked and wipes upward from its own bottom edge as its row nears the bottom
 * of the viewport, like a curtain rising. The card never moves — only the mask
 * changes — which is what keeps it clear of every piece of geometry in
 * `TeamGrid` and `WeekSchedule` that is transcribed from the mockups.
 */

/** Fully masked: the whole card is clipped away from the top edge downward. */
export const REVEAL_HIDDEN = "inset(100% 0% 0% 0%)";

/**
 * Fully revealed. Deliberately `inset(0%)` rather than `none`: the tween has to
 * stay alive for ScrollTrigger's `reverse`, so this value stays on the element
 * as an inline style. It clips exactly at the border box, so the cards' rounded
 * corners and their `ring-inset` selected edge are all inside it and nothing is
 * cut.
 *
 * Written in the same four-value form as REVEAL_HIDDEN on purpose. Chrome's
 * *computed* clip-path collapses `inset(100% 0 0 0)` to the three-value
 * shorthand `inset(100% 0px 0px)`, and handing GSAP a start string with a
 * different token count than the end string is how string interpolation goes
 * wrong — hence a `fromTo` with both ends spelled out rather than a `to` that
 * reads the computed value.
 */
export const REVEAL_SHOWN = "inset(0% 0% 0% 0%)";

/** Seconds for one card's wipe. */
export const REVEAL_DURATION = 1.2;

/** Seconds between one card in a row and the next. */
export const REVEAL_STEP = 0.1;

/**
 * ScrollTrigger's start position: fire when the card's top reaches 100px above
 * the bottom of the viewport, so a row has begun revealing by the time it is
 * properly on screen rather than after.
 */
export const REVEAL_START = "top bottom-=100";

/**
 * The registered name of the eased curve. The curve is `cubic-bezier(0.4, 0,
 * 0.2, 1)`, registered once via CustomEase in `use-card-reveal.ts` — GSAP's
 * built-in `power2.inOut` is close but not the same curve.
 */
export const REVEAL_EASE = "pick-reveal";

/**
 * How many columns a grid is actually drawing, read from its *computed*
 * `grid-template-columns`. Returns 0 when the value can't be counted.
 *
 * Reading the live value rather than hardcoding a number is the whole point.
 * Neither pick surface has a fixed column count: `TeamGrid` steps 3 -> 4 -> 5
 * -> 6 across `min-[480px]`, `md` and `lg`, and `WeekSchedule` is
 * `repeat(auto-fill, minmax(260px, 1fr))`, whose count is content-driven and so
 * cannot be derived from breakpoints at all. A hardcoded modulus would only
 * coincide with real rows at one width, and everywhere else the cascade would
 * drift diagonally across rows instead of resetting at each one.
 *
 * The computed value is not the authored value, and the two ways that bites are
 * both handled here:
 *
 * - Line names come back as bracketed groups *between* the tracks
 *   (`[full-start] 100px [main] 100px`). They are not tracks.
 * - A `repeat()` can come back verbatim rather than resolved, and its internal
 *   comma splits into two plausible-looking "tracks" — which is worse than not
 *   answering, because 2 is a number the caller would trust. Any surviving
 *   parenthesis therefore means "unreadable", and `countColumnsByRow` takes
 *   over.
 *
 * That last case is not hypothetical or limited to unrendered elements.
 * `WeekSchedule`'s grid element is its `<fieldset>`, and a fieldset's grid
 * formatting context lives on its anonymous content box — Chrome reports
 * `repeat(auto-fill, minmax(260px, 1fr))` back off the fieldset at every width,
 * fully laid out, with the cards visibly in three columns behind it. Measured,
 * not assumed.
 */
export function columnCountFrom(value: string): number {
  const tracks = value.replace(/\[[^\]]*\]/g, " ").trim();
  if (!tracks || tracks === "none") return 0;
  if (tracks.includes("(")) return 0;
  return tracks.split(/\s+/).length;
}

/**
 * The same count, taken from where the cards actually ARE: how many of them
 * share the first one's top edge.
 *
 * This is the answer whenever `columnCountFrom` declines, and between them the
 * hook is correct on any grid rather than only on ones that report their tracks.
 *
 * It stops at the first row rather than counting every matching top, because a
 * later row can land on the same coordinate once the page scrolls, and
 * `tops[0]` is only meaningful as the start of a run. The tolerance absorbs
 * sub-pixel track rounding — a real three-column row measures as
 * `120.656 / 120.672 / 120.656`, not three identical numbers.
 *
 * It is also immune to the thing that makes the computed read awkward at mount:
 * `.stagger`'s entrance transform moves every card by the same 12px, so tops
 * relative to each other are unaffected.
 *
 * Never returns 0 — that would make `index % columns` NaN, which does not throw
 * and would silently delete the stagger instead.
 */
export function countColumnsByRow(tops: readonly number[], tolerance = 1): number {
  const first = tops[0];
  if (first === undefined) return 1;
  let count = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > tolerance) break;
    count += 1;
  }
  return count > 0 ? count : 1;
}

/**
 * How long the card at `index` waits before it wipes.
 *
 * The modulus is what makes this a per-ROW cascade rather than a per-GRID one.
 * Cards in the same row sit at the same vertical position and so cross the
 * trigger line at the same scroll moment; the left-to-right feel comes entirely
 * from this delay. Resetting it at the start of every row keeps each row's
 * cascade to `REVEAL_STEP * columns` — instead of the delay growing without
 * bound down the grid, which by the 32nd card would be a three-second wait for
 * a card already on screen.
 *
 * `columns` is floored at 1 so an unreadable `columnCountFrom` (which answers 0)
 * degrades to "the row reveals together" rather than dividing by zero. The
 * result is rounded because `3 * 0.1` is not 0.3 in binary floating point, and
 * a timeline position is nicer to read — and to assert on — without the tail.
 */
export function revealDelay(index: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns));
  const at = Math.max(0, Math.floor(index));
  return Math.round((at % cols) * REVEAL_STEP * 1000) / 1000;
}

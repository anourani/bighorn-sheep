/**
 * The arithmetic behind `WeekStrip`, kept out of the component so it unit-tests
 * without a component-test stack — the same split `shell/nav.ts` makes, and the
 * repo's standing convention (vitest runs in the Node environment; there is no
 * jsdom and no @testing-library here).
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Where the scroller must sit for `item` to be on screen, clamped to the range
 * `scrollLeft` actually accepts.
 *
 * Computed rather than delegated to `element.scrollIntoView()` because that
 * walks *every* scrollable ancestor: with the strip near the top of a long page
 * it will also scroll the document to bring the chip into view, so selecting a
 * week jogs the page vertically. Writing `scrollLeft` on the one container we
 * mean cannot do that, under any condition.
 *
 * Two alignments, because the two moments want different things:
 *
 * - `center` for arriving — the selected week should look deliberately placed,
 *   with the weeks either side of it visible.
 * - `nearest` for moving, which returns the current `scrollLeft` untouched when
 *   the chip is already fully visible. Centring on every tap would slide the
 *   strip out from under the finger that just tapped it; this only moves when
 *   the chip is actually cut off.
 *
 * The clamp is what makes the ends behave: the first and last chips cannot be
 * centred — there is no content past the edge to fill the other half — so they
 * settle flush instead, which is also what stops a smooth scroll from visibly
 * over-travelling and springing back.
 */
export function scrollLeftFor({
  scrollLeft,
  viewWidth,
  contentWidth,
  itemStart,
  itemWidth,
  align,
}: {
  /** The scroller's current `scrollLeft`. */
  scrollLeft: number;
  /** The scroller's visible width (`clientWidth`). */
  viewWidth: number;
  /** The full scrollable width (`scrollWidth`). */
  contentWidth: number;
  /** The item's start within the scrolled content, in the same axis as `scrollLeft`. */
  itemStart: number;
  itemWidth: number;
  align: "center" | "nearest";
}): number {
  const max = Math.max(0, contentWidth - viewWidth);

  if (align === "center") {
    return Math.round(clamp(itemStart + itemWidth / 2 - viewWidth / 2, 0, max));
  }

  if (itemStart < scrollLeft) return Math.round(clamp(itemStart, 0, max));
  const itemEnd = itemStart + itemWidth;
  if (itemEnd > scrollLeft + viewWidth) return Math.round(clamp(itemEnd - viewWidth, 0, max));
  return Math.round(clamp(scrollLeft, 0, max));
}

/**
 * Roving-tabindex keyboard movement for the chip row.
 *
 * Returns the index to move to, or null when the key isn't ours — which is the
 * signal not to `preventDefault`, so Tab, Enter and everything else keep their
 * normal behaviour. Up and Down are deliberately not ours: the page still has to
 * scroll with the strip focused.
 *
 * Movement clamps at the ends rather than wrapping. Wrapping is allowed for a
 * tablist, but the strip is an ordered axis with a scroll position attached:
 * arrowing left off Week 1 to land on Week 18 would fling the scroller the whole
 * way across, which reads as a glitch rather than as navigation.
 */
export function nextIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  // A `current` outside the list (nothing selected yet, or the selection dropped
  // out from under us) starts from the top rather than throwing the maths off.
  const from = current >= 0 && current < length ? current : 0;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, from - 1);
    case "ArrowRight":
      return Math.min(length - 1, from + 1);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

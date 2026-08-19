/**
 * Keyboard and id logic for {@link ../ui/Tabs}, kept pure so it can be tested
 * without a DOM — this repo's vitest runs in node, and the convention beside
 * `week-strip.ts`, `team-grid.ts` and `nav.ts` is a pure module plus its test.
 */

/**
 * Roving-tabindex movement for a tablist.
 *
 * Returns the index to move to, or null when the key isn't ours — the signal not
 * to `preventDefault`, so Tab, Enter and page scrolling keep working. Up and
 * Down are deliberately not ours: a horizontal tablist should let the page
 * scroll.
 *
 * Movement WRAPS, which is the one place this differs from `nextIndex` in
 * `src/components/picks/week-strip.ts`, and the difference is real rather than
 * duplication. WAI-ARIA specifies wrapping for tabs, and there is nothing to
 * glitch: three tabs are all on screen at once. The week strip clamps because it
 * is an ordered axis with a scroll position attached, where arrowing off Week 1
 * onto Week 18 would fling the scroller the whole way across.
 */
export function nextTabIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  // A `current` outside the list starts from the top rather than throwing the
  // maths off — same defence as the week strip's.
  const from = current >= 0 && current < length ? current : 0;
  switch (key) {
    case "ArrowLeft":
      return (from - 1 + length) % length;
    case "ArrowRight":
      return (from + 1) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

/**
 * Ids linking a tab to its panel.
 *
 * Both directions are needed and neither is optional: the tab carries
 * `aria-controls={panelId(...)}` and the panel `aria-labelledby={tabId(...)}`,
 * which is what makes a screen reader announce "Members, tab 1 of 3" and then
 * read the right region.
 */
export function tabId(base: string, value: string): string {
  return `${base}-tab-${value}`;
}

export function panelId(base: string, value: string): string {
  return `${base}-panel-${value}`;
}

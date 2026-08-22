"use client";

import { cn } from "@/lib/cn";
import { H3 } from "@/lib/type-scale";
import { Label } from "@/components/ui/Label";
import { GRID_LAYOUTS, type GridLayout } from "@/components/picks/team-grid";

/**
 * The Layout filter above the pick surface.
 *
 * Plain text, not a segmented pill: the design sets the live option in page ink
 * and the rest in the tertiary grey, with no track behind them. `ui/Segmented`
 * is the pill and would be the wrong shape here.
 *
 * That unselected grey is `shell-faint` (#858585) and is deliberately NOT the
 * `shell-mute` (#757575) the `Label` eyebrow above it takes — the two used to
 * be the same token, which read the dormant half of the row at the same weight
 * as the live one.
 *
 * The options are H3, one size at every width. They used to step 20px on a
 * phone to 28px from `lg`; the mock-up now draws 32px on the phone, and H3 is
 * a single step rather than a responsive pair, so the `lg:` half is gone.
 *
 * There was a second group here — Sort, over Team Record and ABCs, which
 * ordered the grid's 32 cards and was greyed out on the matchup layout because
 * a list of fixtures has only kickoff order. It is gone from the design, and
 * with it the whole notion of an inert group: `shell-disabled` was its colour
 * and has no other consumer. The grid now takes Team Record always.
 *
 * The options are real radio inputs behind an `sr-only` class rather than
 * styled buttons, which is what gets arrow-key navigation, a single tab stop
 * and the grouping semantics for free — and lets the active styling be
 * `peer-checked:`, so nothing has to re-derive it from React state.
 */

const LAYOUT_COPY: Record<GridLayout, string> = {
  grid: "Grid",
  matchups: "Matchups",
};

export function PickFilters({
  layout,
  onLayoutChange,
  className,
}: {
  layout: GridLayout;
  onLayoutChange: (next: GridLayout) => void;
  className?: string;
}) {
  return (
    // The eyebrow sits above its options on a phone and beside them from lg —
    // the one place the page turns over, same as everything else here.
    // items-start, not items-center: the mockups top-align the 12px label with
    // the option row rather than centering it against the taller text.
    //
    // No wrapper above this. While Sort existed the two groups needed a flex
    // row to sit in; one group is its own row, and the empty parent was a
    // `flex-wrap` with nothing to wrap.
    <div
      role="radiogroup"
      aria-label="Layout"
      className={cn("flex flex-col gap-1.5 lg:flex-row lg:items-start lg:gap-2", className)}
    >
      {/* The eyebrow is `shell-mute` — it names the group rather than being
          part of the control. */}
      <Label>Layout</Label>
      <div className="flex items-center gap-2">
        {GRID_LAYOUTS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name="picks-layout"
              className="peer sr-only"
              checked={option === layout}
              onChange={() => onLayoutChange(option)}
            />
            <span
              className={cn(
                "block rounded-[2px] transition-colors",
                H3,
                "text-shell-faint peer-checked:text-shell-ink",
                // Tailwind v3 doesn't gate `hover:` on a real pointer, and an
                // ungated one sticks after a tap on touch.
                "[@media(hover:hover)]:hover:text-shell-ink",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg",
              )}
            >
              {LAYOUT_COPY[option]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

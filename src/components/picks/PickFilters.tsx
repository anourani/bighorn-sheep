"use client";

import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/Label";
import {
  GRID_LAYOUTS,
  GRID_SORTS,
  type GridLayout,
  type GridSort,
} from "@/components/picks/team-grid";

/**
 * The Layout and Sort filters above the pick surface.
 *
 * Plain text, not a segmented pill: the design sets the live option in page ink
 * and the rest in the tertiary grey, with no track behind them. `ui/Segmented`
 * is the pill and would be the wrong shape here.
 *
 * That unselected grey is `shell-faint` (#858585) and is deliberately NOT the
 * `shell-mute` (#757575) the `Label` eyebrow beside it takes — the two used to
 * be the same token, which read the dormant half of the row at the same weight
 * as the live one. A disabled group drops a step further again, to
 * `shell-disabled` (#BABABA).
 *
 * The option text is responsive, not one fixed size: 20px on a phone, 28px
 * from `lg` — the mockups step it up along with everything else that turns
 * over at that breakpoint, tracking included (-0.8px mobile, -0.56px desktop).
 *
 * Both groups are real radio inputs behind an `sr-only` class rather than styled
 * buttons, which is what gets arrow-key navigation, a single tab stop per group
 * and the grouping semantics for free — and lets the active styling be
 * `peer-checked:`, so nothing has to re-derive it from React state.
 */

const LAYOUT_COPY: Record<GridLayout, string> = {
  grid: "Grid",
  matchups: "Matchups",
};

const SORT_COPY: Record<GridSort, string> = {
  record: "Team Record",
  abc: "ABCs",
};

export function PickFilters({
  layout,
  onLayoutChange,
  sort,
  onSortChange,
  className,
}: {
  layout: GridLayout;
  onLayoutChange: (next: GridLayout) => void;
  sort: GridSort;
  onSortChange: (next: GridSort) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start gap-x-5 gap-y-3 lg:items-center lg:gap-x-6", className)}>
      <FilterGroup
        label="Layout"
        name="picks-layout"
        options={GRID_LAYOUTS}
        copy={LAYOUT_COPY}
        value={layout}
        onChange={onLayoutChange}
      />
      {/* Sort orders the grid's 32 cards and nothing else — the matchup list is
          the week's fixtures in kickoff order, which is the only order it has.

          Present but disabled rather than unmounted. Unmounting reflowed the
          row on every layout toggle: from `lg`, `MyPicksClient` lays this out
          `justify-between` against the "Select a Team" heading, so a narrower
          right-hand child slides the Layout group across — and it threw away
          any sign that a sort exists, or which one you get back on returning to
          Grid. The old objection to disabling ("an inert control that looks
          live is worse than one that isn't there") is answered by the colour:
          BOTH options drop to `shell-disabled`, the checked one included, so
          nothing in the group reads as active.

          `!== "grid"` rather than `=== "matchups"`: the rule is "sort orders the
          grid and nothing else", so a third layout should arrive with no sort
          rather than silently inheriting one. Equivalent today — `GridLayout`
          is a two-member union. */}
      <FilterGroup
        label="Sort"
        name="picks-sort"
        options={GRID_SORTS}
        copy={SORT_COPY}
        value={sort}
        onChange={onSortChange}
        disabled={layout !== "grid"}
      />
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  name,
  options,
  copy,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  name: string;
  options: readonly T[];
  copy: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
  /** Renders the group inert: every option greyed, unclickable, out of the tab order. */
  disabled?: boolean;
}) {
  return (
    // The label sits above its options on a phone and beside them from lg —
    // the one place the page turns over, same as everything else here.
    // items-start, not items-center: the mockups top-align the 12px label
    // with the option row rather than centering it against the taller text.
    <div
      role="radiogroup"
      aria-label={label}
      // `|| undefined` omits the attribute rather than rendering
      // aria-disabled="false" on every live group.
      aria-disabled={disabled || undefined}
      className="flex flex-col gap-2 lg:flex-row lg:items-start"
    >
      {/* The eyebrow keeps `shell-mute` in both states — it names the group
          rather than being part of the control, and greying it too would leave
          nothing at reading weight. */}
      <Label>{label}</Label>
      <div className="flex items-center gap-1 lg:gap-2">
        {options.map((option) => (
          <label key={option} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={option === value}
              // The real thing, not a styling flag: a label wrapping a disabled
              // input forwards no click, and the group leaves the tab order.
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            <span
              className={cn(
                "block rounded-[2px] text-[20px] font-semibold leading-[1.2] tracking-[-0.8px] transition-colors lg:text-[28px] lg:tracking-[-0.56px]",
                // One branch, NOT `peer-disabled:` stacked beside
                // `peer-checked:`. Those two compile to the same specificity
                // (`.peer:checked ~ &` / `.peer:disabled ~ &`), so which one
                // paints a checked-AND-disabled option would be decided by
                // Tailwind's generated variant order rather than by anything
                // written here — and tailwind-merge files both in its one
                // text-colour group on top of that. The design's answer is that
                // the checked option greys with the rest, so it must not be left
                // to emergent ordering.
                disabled
                  ? "text-shell-disabled"
                  : [
                      "text-shell-faint peer-checked:text-shell-ink",
                      // Tailwind v3 doesn't gate `hover:` on a real pointer, and
                      // an ungated one sticks after a tap on touch.
                      "[@media(hover:hover)]:hover:text-shell-ink",
                    ],
                // Always emitted: a disabled input is never focusable, so the
                // variant simply never matches while the group is inert.
                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg",
              )}
            >
              {copy[option]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

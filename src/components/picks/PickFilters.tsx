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
 * at 20px and the rest in the muted grey, with no track behind them.
 * `ui/Segmented` is the pill and would be the wrong shape here.
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
    <div className={cn("flex flex-wrap items-start gap-x-6 gap-y-3", className)}>
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
          Hidden rather than disabled: an inert control that looks live is worse
          than one that isn't there. */}
      {layout === "grid" ? (
        <FilterGroup
          label="Sort"
          name="picks-sort"
          options={GRID_SORTS}
          copy={SORT_COPY}
          value={sort}
          onChange={onSortChange}
        />
      ) : null}
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
}: {
  label: string;
  name: string;
  options: readonly T[];
  copy: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    // The label sits above its options on a phone and beside them from lg —
    // the one place the page turns over, same as everything else here.
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-col gap-2 lg:flex-row lg:items-center"
    >
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={option === value}
              onChange={() => onChange(option)}
            />
            <span
              className={cn(
                "block rounded-[2px] text-[20px] font-semibold leading-[1.2] tracking-[-0.8px] transition-colors",
                "text-shell-mute peer-checked:text-shell-ink",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg",
                // Tailwind v3 doesn't gate `hover:` on a real pointer, and an
                // ungated one sticks after a tap on touch.
                "[@media(hover:hover)]:hover:text-shell-ink",
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

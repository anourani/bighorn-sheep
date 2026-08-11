"use client";

import { useId } from "react";
import { ChevronDownIcon } from "@/components/icons";
import type { WeekOptionGroup } from "@/lib/nfl/calendar";

/**
 * The My Picks week selector: an eyebrow, then the viewed week's name at page
 * scale with a chevron — the whole thing a native `<select>` in disguise.
 *
 * The disguise is a transparent select laid OVER the title, not an
 * `appearance-none` select painted to look like it, because a select can only
 * ever display its selected option's own text. Two things make that
 * insufficient here: the options append " · current" to the live week, which
 * belongs in the open list and not in a 20px heading; and a select sizes itself
 * to its *widest* option, which would leave dead space between the title and
 * the chevron the spec puts 4px after it.
 *
 * Overlaying keeps the expanded menu the platform's own — no popover, no
 * listbox, no focus trap to get wrong, and optgroups that behave on iOS.
 *
 * The design spec carries `font-variant: small-caps`, deliberately not applied,
 * for the reason spelled out in `SectionHeader`: Figma emits that property
 * whether or not the rendered text uses it.
 */
export function WeekPicker({
  title,
  groups,
  value,
  onChange,
}: {
  /** The trigger's visible text — the week's own name, e.g. "Week 4". */
  title: string;
  groups: WeekOptionGroup[];
  /** `weekKey(ref)` of the selected option. */
  value: string;
  onChange: (key: string) => void;
}) {
  const selectId = useId();

  return (
    <div>
      {/*
        A real <label>, not aria-label: the accessible name is then the exact
        string on screen and cannot drift from it, and clicking the eyebrow
        focuses the control. `w-fit` stops a block label from claiming the rest
        of the line as an invisible hit area.

        Which is also why the classes are `Label`'s repeated by hand rather than
        the component itself: `Label` renders a <span>. Keep the two in sync.
      */}
      <label
        htmlFor={selectId}
        className="block w-fit cursor-pointer text-sm font-semibold uppercase leading-none text-[#757575]"
      >
        Change week
      </label>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-2">
        <div className="relative flex">
          {/*
            First in the DOM so the title can be its `peer` — Tailwind's peer-*
            compiles to a sibling combinator, so it only reaches forwards. An
            opacity-0 control still takes focus and still opens on tap, but the
            global :focus-visible ring in globals.css paints on it invisibly,
            which is why the ring is mirrored onto the title below.

            -inset-y-2 stretches the 28px title box across the row's 8px padding
            for a 44px tap target that stops exactly at the hairline rather than
            spilling onto whatever follows. It also grows correctly if the title
            ever wraps, which a fixed height would not.

            inset-x-0 pins the width to the title box, so the select's intrinsic
            "as wide as the longest option" sizing never reaches layout.
            text-base keeps iOS Safari from zooming the viewport on focus.
          */}
          <select
            id={selectId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="peer absolute inset-x-0 -inset-y-2 z-10 cursor-pointer text-base opacity-0"
          >
            {groups.map((group, i) =>
              group.label === null ? (
                group.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                    {o.isCurrent ? " · current" : ""}
                  </option>
                ))
              ) : (
                <optgroup key={group.label ?? i} label={group.label}>
                  {group.options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                      {o.isCurrent ? " · current" : ""}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>

          <span className="flex items-center gap-1 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white">
            <span className="text-xl font-bold leading-[1.4] text-black">{title}</span>
            {/* The icon set is drawn on a 24-unit grid, so at 20×20 it scales by
                20/24 — 2.4 units is what renders as a true 2px stroke. */}
            <ChevronDownIcon className="h-5 w-5 shrink-0 text-[#1E1E1E]" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/Label";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { WeekOption } from "@/lib/nfl/calendar";
import { nextIndex, scrollLeftFor } from "./week-strip";

/**
 * The My Picks week selector: an eyebrow over a filmstrip of 50px chips that
 * scrolls sideways, one per week of the season.
 *
 * This replaced a native `<select>` worn under a "Week 4" heading. The dropdown
 * could only ever show the week you were on; the strip shows the whole axis at
 * once, and draws a week you have already played as the team you spent there —
 * which is the point of the redesign, and the reason the option list is no
 * longer forward-only (see `weekStripOptions`).
 *
 * The week's *name* is not repeated here. A 50px square only fits "04", and
 * `PickHero` directly below already reads "Your Pick · Week 4", so the full name
 * stays on screen without this component competing for it. Every chip still
 * carries its name as its accessible name — see `chipName` below.
 *
 * The spec draws no affordance for the *live* week, which the dropdown marked
 * with a "· current" suffix. That distinction survives in two places rather than
 * three: each chip's accessible name, and the prose in `MyPicksClient` that
 * appears precisely when you are looking at some other week.
 */

/** Named once: the visible eyebrow and the tablist's accessible name are the
 *  same string, so they cannot drift apart. */
const HEADING = "Select a week";

/**
 * 50×50 clears the 44px `.tap-target` floor on both axes, so no `.tap-target`
 * here. Both transitioned properties are named: `transition-colors` alone would
 * snap the radius change on hover while easing the fill.
 */
const CHIP =
  "relative flex h-[50px] w-[50px] shrink-0 select-none flex-col items-center " +
  "justify-center px-1 transition-[background-color,border-radius] duration-150";

export function WeekStrip({
  options,
  value,
  picked,
  onChange,
}: {
  options: WeekOption[];
  /** `weekKey(ref)` of the selected option. */
  value: string;
  /** Team picked per `weekKey`. An absent key means no pick that week. */
  picked: ReadonlyMap<string, TeamId>;
  onChange: (key: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  // Distinguishes the first paint (jump straight to the right place) from a
  // later selection (ease, and only if the chip is actually cut off). A state
  // flag would re-render for nothing.
  const settled = useRef(false);

  const found = options.findIndex((o) => o.key === value);
  const selectedIndex = found === -1 ? 0 : found;

  // Keep the selected chip in view: centred on arrival, and nudged into view
  // whenever the selection moves — including when it moves from somewhere other
  // than a chip.
  useEffect(() => {
    const el = scroller.current;
    const chip = chips.current[selectedIndex];
    if (!el || !chip) return;

    // Measured by rect delta rather than `chip.offsetLeft`, which is relative to
    // whichever ancestor happens to be positioned — so it would silently start
    // reading page coordinates the day someone drops `relative` from a wrapper.
    const box = el.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();

    const left = scrollLeftFor({
      scrollLeft: el.scrollLeft,
      viewWidth: el.clientWidth,
      contentWidth: el.scrollWidth,
      itemStart: el.scrollLeft + (chipBox.left - box.left),
      itemWidth: chipBox.width,
      align: settled.current ? "nearest" : "center",
    });

    // The global reduced-motion rule in globals.css only zeroes animation and
    // transition durations; a programmatic smooth scroll has to opt out itself.
    const still =
      !settled.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left, behavior: still ? "auto" : "smooth" });
    settled.current = true;
  }, [selectedIndex]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextIndex(selectedIndex, event.key, options.length);
    if (next === null) return; // not ours — leave Tab, Enter and page scroll alone
    event.preventDefault();

    // `preventScroll` because the browser's own focus scroll walks every
    // scrollable ancestor and can move the page vertically — the exact thing the
    // effect above avoids. The effect does the horizontal scroll properly.
    chips.current[next]?.focus({ preventScroll: true });
    const option = options[next];
    if (option && option.key !== value) onChange(option.key);
  }

  return (
    // space-y-0.5 (2px) + the scroller's py-1.5 (6px) is the spec's 8px gap.
    <div className="space-y-0.5">
      <Label className="lg:text-base lg:leading-[1.1]">{HEADING}</Label>

      {/*
        Full-bleed below `lg`, the same treatment — and the same `-mx-4` assuming
        the `px-4` host in app/layout.tsx — that StandingsGrid gets, keyed off the
        same breakpoint so there is no width where one bleeds and the other does
        not. A strip that stops short of the screen edge reads as finished; one
        running off it reads as scrollable. The `px-4` inside puts the first chip
        back on the page's own gutter, in line with the eyebrow above it.

        `py-1.5` is not padding for looks. `overflow-x-auto` computes `overflow-y`
        to `auto`, so this box clips vertically as well as horizontally — and the
        global :focus-visible ring (globals.css:23) draws `ring-2` at
        `ring-offset-2`, i.e. 4px outside a chip that already fills the row's
        height. Without the 6px the ring is sliced off top and bottom on every
        keyboard focus. `lg:-mx-1`/`lg:px-1` buy the same 4px horizontally for the
        first and last chips while keeping them flush with the content column.
      */}
      <div
        ref={scroller}
        className="-mx-4 overflow-x-auto py-1.5 scroll-none lg:-mx-1"
      >
        {/* w-max so the row sizes to its chips and actually overflows; without it
            it would be capped at the scroller's width and never scroll. */}
        <div
          role="tablist"
          aria-label={HEADING}
          aria-orientation="horizontal"
          onKeyDown={handleKeyDown}
          className="flex w-max items-center gap-px px-4 lg:px-1"
        >
          {options.map((option, i) => (
            <Chip
              key={option.key}
              ref={(el) => {
                chips.current[i] = el;
              }}
              option={option}
              team={picked.get(option.key)}
              selected={i === selectedIndex}
              onSelect={() => onChange(option.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The chip's accessible name. The chip prints "04", which on its own names
 * nothing — so the numeral is hidden and this is supplied instead.
 */
function chipName(option: WeekOption, teamName: string | null): string {
  const parts = [option.label];
  if (teamName) parts.push(`picked ${teamName}`);
  if (option.isCurrent) parts.push("current week");
  return parts.join(", ");
}

function Chip({
  ref,
  option,
  team,
  selected,
  onSelect,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  option: WeekOption;
  /** The team picked this week, if any — the chip then shows its logo. */
  team: TeamId | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = team ? getTeam(team) : undefined;
  const teamName = meta ? `${meta.location} ${meta.name}` : null;

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      // aria-label rather than the visible text: it replaces the name computed
      // from the contents outright, so the bare numeral and the corner number
      // are never read, and TeamLogo's own alt text cannot double up.
      aria-label={chipName(option, teamName)}
      // Roving tabindex: one tab stop for the whole strip, not twenty-two. Arrow
      // keys move within it — see handleKeyDown above.
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        CHIP,
        selected ? "bg-selected" : "bg-fill-soft",
        // The radius grows only on a bare selected chip. A chip showing a logo
        // keeps the 2px corner in every state — the spec draws it tight there so
        // a round logo isn't fighting a rounded box.
        selected && !team ? "rounded-control" : "rounded-sm",
        // Gated on a real pointer. Tailwind v3 does not gate `hover:` behind
        // `@media (hover: hover)` unless `future.hoverOnlyWhenSupported` is set,
        // and it isn't here — so a plain `hover:` sticks on touch after a tap,
        // leaving the last week you touched shaded as though it were focused.
        !selected && "[@media(hover:hover)]:hover:bg-shell-line",
        !selected && !team && "[@media(hover:hover)]:hover:rounded",
      )}
    >
      {team ? (
        <>
          <TeamLogo teamId={team} size={28} />
          <span
            className={cn(
              "pointer-events-none absolute right-[2px] top-[2px] text-[10px] font-semibold",
              "leading-[0.9] tracking-[-0.05em] tabular-nums",
              selected ? "text-white" : "text-shell-mute",
            )}
          >
            {option.chipLabel}
          </span>
        </>
      ) : (
        <span
          className={cn(
            // tabular-nums so "11" and "18" are the same width; Inter's default
            // proportional figures make a column of them visibly ragged.
            "w-full text-center font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums",
            // The spec's -1.4px at 28px is -0.05em, written as the ratio so the
            // preseason step-down below stays proportionally right.
            //
            // "HOF" at 28px measures wider than the 42px the chip has to give.
            // The spec only ever draws two-digit numerals, so this is the
            // preseason case it doesn't cover.
            option.chipLabel.length > 2 ? "text-[18px]" : "text-[28px]",
            selected ? "text-white" : "text-shell-ink",
          )}
        >
          {option.chipLabel}
        </span>
      )}
    </button>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/Label";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import { getTeam } from "@/lib/nfl/teams";
import type { WeekOption } from "@/lib/nfl/calendar";
import { chipName, nextIndex, scrollLeftFor, type ChipOutcome, type ChipPick } from "./week-strip";

/**
 * The My Picks week selector: an eyebrow over a filmstrip of 52px chips that
 * scrolls sideways, one per week of the season.
 *
 * This replaced a native `<select>` worn under a "Week 4" heading. The dropdown
 * could only ever show the week you were on; the strip shows the whole axis at
 * once, and draws a week you have already played as the team you spent there —
 * which is the point of the redesign, and the reason the option list is no
 * longer forward-only (see `weekStripOptions`).
 *
 * The week's *name* is not repeated here. A 52px square only fits "04", and
 * `PickHero` directly below already reads "Your Week 4 Pick", so the full name
 * stays on screen without this component competing for it. Every chip still
 * carries its name as its accessible name — see `chipName` below.
 *
 * The spec draws no affordance for the *live* week, which the dropdown marked
 * with a "· current" suffix. That distinction survives in two places rather than
 * three: each chip's accessible name, and the prose in `MyPicksClient` that
 * appears precisely when you are looking at some other week.
 *
 * A week you have already played reads its result off the chip's FILL — green
 * if you got through it, red if you didn't, grey while it is still open. That
 * used to be the corner numeral's colour alone, which at 10px on a 52px tile
 * is a few dozen pixels; the numeral keeps the same two hues and the tile
 * behind it now carries them too. The outcome is derived in `buildChipPicks`;
 * see `ChipOutcome`.
 */

/** Named once: the visible eyebrow and the tablist's accessible name are the
 *  same string, so they cannot drift apart. */
const HEADING = "Select a week";

/**
 * 52×52 clears the 44px `.tap-target` floor on both axes, so no `.tap-target`
 * here. Both transitioned properties are named: `transition-colors` alone would
 * snap the radius change on hover while easing the fill.
 */
const CHIP =
  "relative flex h-[52px] w-[52px] shrink-0 select-none flex-col items-center " +
  "justify-center px-1 transition-[background-color,border-radius] duration-150";

/**
 * The corner numeral's ink, by outcome and by whether the chip is filled.
 *
 * A table rather than a chain of conditional fragments because all six values
 * land in tailwind-merge's ONE text-colour group: emit two and the later
 * silently deletes the earlier, with the winner decided by argument order. One
 * lookup, one class, nothing to reason about.
 *
 * The `undecided` row is what every chip printed before the redesign.
 *
 * `win` and `loss` read the same either way, and they are no longer the only
 * thing saying which it was — `CHIP_FILL` below now carries the same fact at
 * tile size. The `on` column used to take a `-lit` pair, lifted to survive the
 * chip's old dark GREEN fill. What it faces now is a LIGHT fill (#7BE170 /
 * #FC615F), where the dark pair measures 3.87:1 and 2.48:1 and the light one
 * would disappear into it. Retired, and still retired — `tailwind.config.ts`
 * has the note on why #7BE170 itself is nonetheless back, as a fill. Keeping
 * the table rather than collapsing the two rows: `undecided` still differs, and
 * the shape is what the note above is about.
 */
const CORNER_INK: Record<ChipOutcome, { off: string; on: string }> = {
  undecided: { off: "text-shell-mute", on: "text-white" },
  win: { off: "text-result-win", on: "text-result-win" },
  loss: { off: "text-result-loss", on: "text-result-loss" },
};

/**
 * The chip's own fill, by outcome and by whether it is the selected chip.
 *
 * Same table-not-conditionals argument as `CORNER_INK` above: the six bare
 * values land in tailwind-merge's ONE background-colour group, so an `off` and
 * an `on` emitted together resolve by argument order and the loser vanishes.
 * `hover` is a third column rather than an alternative to those two precisely
 * because a variant class does NOT conflict with a bare one — it is emitted
 * alongside `off`, not instead of it.
 *
 * `neutral` is what every chip painted before this: the grey/accent pair, which
 * a week with no pick and a week whose game has not gone final both still take.
 * The spec draws those two rows identically, so they share one row here.
 *
 * The greys are #F3F3F3 and #D9D9D9 against the spec's #F2F2F2 and #DADADA: one
 * point apart, below anything anyone can see, and both tokens are load-bearing
 * across the app. A third near-identical grey would leave this chip a different
 * grey from every other flat tile on the page. Deliberate.
 *
 * The two `off` values are NOT symmetrical — win tints the light green, loss
 * tints the dark red. That reads as a slip in the spec's own table and is what
 * it draws; both land on a pale tint of about the same weight. Transcribed, not
 * derived. See the note on `result` in `tailwind.config.ts`.
 */
const CHIP_FILL: Record<"neutral" | "win" | "loss", { off: string; hover: string; on: string }> = {
  neutral: {
    off: "bg-fill-soft",
    hover: "[@media(hover:hover)]:hover:bg-shell-line",
    on: "bg-accent",
  },
  win: {
    off: "bg-result-win-fill/60",
    hover: "[@media(hover:hover)]:hover:bg-result-win-fill-deep/50",
    on: "bg-result-win-fill",
  },
  loss: {
    off: "bg-result-loss-fill-deep/40",
    hover: "[@media(hover:hover)]:hover:bg-result-loss-fill-deep/50",
    on: "bg-result-loss-fill",
  },
};

export function WeekStrip({
  options,
  value,
  picked,
  onChange,
}: {
  options: WeekOption[];
  /** `weekKey(ref)` of the selected option. */
  value: string;
  /**
   * What each week's chip draws — the team picked and how it went — per
   * `weekKey`. An absent key means no pick that week.
   *
   * One map to a record rather than a second map keyed the same way: an
   * outcome only exists where a pick does, and two maps can be given different
   * dependency lists and drift apart. Same shape as `usedByTeam` next door.
   */
  picked: ReadonlyMap<string, ChipPick>;
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
            it would be capped at the scroller's width and never scroll.

            The 2px gutter is the spec's, and the budget is measured rather
            than loose: 18 chips come to 18×52 + 17×2 = 970px against the 1000px
            this row has on desktop (the content column at its cap, plus and
            minus the 4px `lg:-mx-1`/`lg:px-1` pair below, which cancel). It used
            to overhang a 968 column by exactly 2px and be
            technically scrollable all year; the wider column bought 30px and it
            now fits. Anything further added here (a border, a ring, row padding,
            a wider gap) comes off those 30. */}
        <div
          role="tablist"
          aria-label={HEADING}
          aria-orientation="horizontal"
          onKeyDown={handleKeyDown}
          className="flex w-max items-center gap-0.5 px-4 lg:px-1"
        >
          {options.map((option, i) => (
            <Chip
              key={option.key}
              ref={(el) => {
                chips.current[i] = el;
              }}
              option={option}
              pick={picked.get(option.key)}
              selected={i === selectedIndex}
              onSelect={() => onChange(option.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({
  ref,
  option,
  pick,
  selected,
  onSelect,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  option: WeekOption;
  /** This week's pick, if any — the chip then shows its logo and its result. */
  pick: ChipPick | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = pick ? getTeam(pick.teamId) : undefined;
  const teamName = meta ? `${meta.location} ${meta.name}` : null;
  // "no pick at all" and "picked, not final yet" paint the same, so three rows
  // rather than four. Excluding `undecided` narrows `pick.outcome` to the two
  // that are left, so the lookup needs no cast.
  const fill = CHIP_FILL[pick && pick.outcome !== "undecided" ? pick.outcome : "neutral"];

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      // aria-label rather than the visible text: it replaces the name computed
      // from the contents outright, so the bare numeral and the corner number
      // are never read, and TeamLogo's own alt text cannot double up.
      aria-label={chipName(option, teamName, pick?.outcome)}
      // Roving tabindex: one tab stop for the whole strip, not twenty-two. Arrow
      // keys move within it — see handleKeyDown above.
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        CHIP,
        // One of the six bare fills, never both — see CHIP_FILL. A won week is
        // green here and a lost one red, which means the selected chip is no
        // longer always accent: selection is carried by the jump to the
        // saturated value plus the radius step below, and only a neutral chip
        // still turns orange. That is what the spec draws.
        selected ? fill.on : fill.off,
        // 2 → 4 → 6 as the state escalates, and the ladder runs in EVERY
        // variant. It used to stop at 2px on any chip showing a logo, on the
        // grounds that a round logo shouldn't fight a rounded box; the spec that
        // replaced it draws the same corner growth either way. Don't put the
        // gate back — and note the current frame draws a flat 4px on all twelve
        // variants only because its radius is one bound variable it never
        // varies by state, which is not a reversal of that.
        selected ? "rounded-md" : "rounded-sm",
        // Gated on a real pointer. Tailwind v3 does not gate `hover:` behind
        // `@media (hover: hover)` unless `future.hoverOnlyWhenSupported` is set,
        // and it isn't here — so a plain `hover:` sticks on touch after a tap,
        // leaving the last week you touched shaded as though it were focused.
        // `fill.hover` carries that gate itself; both rows need it.
        !selected && fill.hover,
        !selected && "[@media(hover:hover)]:hover:rounded",
      )}
    >
      {pick ? (
        <>
          {/* `size`, never a class: TeamLogo writes an inline width/height that a
              Tailwind utility can't reach, and carries `max-w-none` so preflight's
              `img { max-width: 100% }` can't letterbox it. 30px inside 44px of
              inner width is clear on both counts.

              The logo is untreated in EVERY state, selected included. The Figma
              spec draws `mix-blend-darken` on the filled chip; it shipped, and it
              erased the light-marked teams — `darken` takes the per-channel
              minimum against the fill, so New Orleans' gold landed on the fill
              exactly and the Colts' white horseshoe came back as an outline.
              (That was measured against the old green #0C6F28 — and a won week
              is filled GREEN again, #7BE170, so that measurement is live rather
              than historical. On every other fill the trap is unchanged:
              `darken` clamps each channel to the fill's own minimum whatever
              its hue.) Don't re-add it from the spec. */}
          <TeamLogo teamId={pick.teamId} size={30} />
          {/* right-[4px] resolves against the padding box — with no border, the
              border box — so this is the spec's 4px from the chip's edge and the
              chip's own px-1 does not double it. No `text-right`: an absolutely
              positioned box with no width shrink-wraps, so it would be a no-op. */}
          <span
            className={cn(
              "pointer-events-none absolute right-[4px] top-[2px] text-[10px] font-semibold",
              "leading-[0.9] tracking-[-0.05em] tabular-nums",
              CORNER_INK[pick.outcome][selected ? "on" : "off"],
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
            "w-full text-center font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums",
            // The library's H3 Desktop metrics. Its -0.56px at 28px is -0.02em,
            // written as the ratio so the preseason step-down below stays
            // proportionally right — note this no longer matches the corner
            // numeral's -0.05em, which is its own value in the spec. leading-1.2
            // doesn't move the glyph: a 33.6px line box inside a 52px
            // justify-center column grows symmetrically.
            //
            // "HOF" at 28px measures wider than the 44px the chip has to give.
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

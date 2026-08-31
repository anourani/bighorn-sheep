"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { HeadcountInput } from "@/lib/league/view";

import { CUBE_DESKTOP, CUBE_GAP, CUBE_PHONE, cubeLayout, type CubeLayout } from "./headcount-grid";

/**
 * One square per member, still-standing first: accent for the living, grey for
 * the dead, wrapped into as many rows as the width needs. Figma cube atom
 * `3746:39826` — 20-24px from `lg`, 14-18px below it.
 *
 * Its own module rather than an export from whichever section draws it, so a
 * signed-out landing page never risks pulling server-only league loading in to
 * draw a grid of squares. This is also the only file in the pair that needs
 * `"use client"`: the label row stays on the server, which keeps the whole of
 * `lib/league/view.ts` — and the ranking apparatus it imports — out of the
 * landing page's client bundle.
 *
 * It replaced a single row of proportional bars, which is worth knowing for the
 * failure that retires: those cells fell below 1 CSS pixel at roughly 59 members
 * at 390px, and past ~87 the gaps ate the whole track. Wrapping trades it for a
 * grid that grows TALLER with the league — a 500-member league is ~25 rows on a
 * phone — which is at least a failure someone can see.
 */
export function HeadcountGrid({
  headcount,
  className,
}: {
  headcount: HeadcountInput;
  className?: string;
}) {
  const eliminated = headcount.kind === "season" ? headcount.eliminated : 0;
  const alive = headcount.kind === "season" ? headcount.alive : headcount.joined;
  const total = alive + eliminated;
  const label =
    headcount.kind === "season"
      ? `${alive} of ${total} players still standing, ${eliminated} eliminated`
      : `${alive} players joined, none eliminated`;

  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<CubeLayout | null>(null);

  /*
    The design's rule — never one cube alone on the last row — cannot be written
    in CSS, which has no way to branch on a count, so the size has to be solved
    against the measured width. `headcount-grid.ts` holds that arithmetic and its
    tests.

    The width comes off the ResizeObserver entry, and both halves of that matter.
    It is a LAYOUT box, where `getBoundingClientRect()` is the transformed one —
    the landing page wraps this section in `blur-in`, which starts at
    `scale(1.04)`, so a rect read mid-animation is 4% wide and buys an extra
    column. And it is FRACTIONAL, where `clientWidth` is rounded: the solver
    restates CSS Grid's own `auto-fill` formula, so on the real number our column
    count and the browser's cannot disagree, and on a rounded one they can.

    Which scale applies is the app's single `lg` turn-over, asked of `matchMedia`
    rather than inferred from the width: below `lg` this grid is full-bleed, so a
    width test would read a 990px browser window as a desktop.

    `useEffect`, not `useLayoutEffect`: the classes below already paint the design
    size at both widths, so the only thing this pass moves is the orphan case, and
    one frame of a cube 1-2px out is not worth an SSR warning to dodge.
  */
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;

    const wide = window.matchMedia("(min-width: 1024px)");
    let width = 0;

    const solve = () => {
      // A hidden ancestor measures 0, which would resolve to one very tall
      // column. Leaving the state alone keeps the CSS fallback in charge.
      if (width <= 0) return;
      const scale = wide.matches ? CUBE_DESKTOP : CUBE_PHONE;
      const next = cubeLayout(total, width, scale);
      // A resize fires for a phone's URL bar sliding away and for a dialog's
      // scroll lock too, and neither of those changes the answer.
      setLayout((prev) =>
        prev && prev.size === next.size && prev.columns === next.columns ? prev : next,
      );
    };

    const observer = new ResizeObserver(([entry]) => {
      width =
        entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width ?? grid.clientWidth;
      solve();
    });
    // `observe` fires once immediately, so this is also the first measurement.
    observer.observe(grid);
    wide.addEventListener("change", solve);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", solve);
    };
  }, [total]);

  return (
    /*
      Two templates, and the class-based one is not a placeholder. `auto-fill`
      reaches the browser's own column count from the true width, so it is
      already the design's size at both widths — it is what the server renders,
      what paints before hydration, and what a browser whose JS never arrives
      keeps. Only a genuine orphan ever moves off it.

      The measured template is explicit — `repeat(N, …)`, never `auto-fill` —
      because a browser allowed to reach its own count could reach one more than
      the solver did and put the lone cube straight back. Its `minmax(0, …)` is
      belt and braces on the same edge: given a width the tracks cannot quite
      fit, they shrink together rather than overflow. An overflow would break out
      of the card's fill at any width, and at `lg` — where the page has no
      horizontal inset left to absorb it — it would reach the document.

      The cube takes its width from the track and its height from `aspect-square`,
      so the two cannot be given different numbers — including on a shrunk track.
    */
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "grid justify-start gap-0.5 [--cube:16px] lg:[--cube:24px]",
        "grid-cols-[repeat(auto-fill,var(--cube))]",
        className,
      )}
      style={
        layout
          ? { gridTemplateColumns: `repeat(${layout.columns}, minmax(0, ${layout.size}px))` }
          : undefined
      }
    >
      {Array.from({ length: alive }).map((_, i) => (
        <span key={`alive-${i}`} className="aspect-square rounded-[2px] bg-accent" />
      ))}
      {Array.from({ length: eliminated }).map((_, i) => (
        <span key={`out-${i}`} className="aspect-square rounded-[2px] bg-shell-line" />
      ))}
    </div>
  );
}

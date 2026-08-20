"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import {
  REVEAL_DURATION,
  REVEAL_EASE,
  REVEAL_HIDDEN,
  REVEAL_SHOWN,
  REVEAL_START,
  columnCountFrom,
  countColumnsByRow,
  revealDelay,
} from "@/components/picks/card-reveal";

/**
 * Registered once, at module scope, rather than on every mount. ES modules
 * evaluate once per graph however many components import them, which is exactly
 * the property wanted here: `registerPlugin` in a component body runs on every
 * mount, and `CustomEase.create` in a component body silently redefines the
 * same id every time.
 *
 * Safe during the server pass despite the DOM-shaped names: ScrollTrigger's
 * `register` gates its own `enable()` on `_windowExists() && window.document`,
 * and CustomEase declares `headless = true` — its `create` is path arithmetic
 * and an ease registration, no document involved. `useGSAP` is registered too so
 * the hook binds to this copy of the core if a second one is ever loaded.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger, CustomEase);

/**
 * `cubic-bezier(0.4, 0, 0.2, 1)` as CustomEase's SVG cubic path. The two are the
 * same object written twice: a cubic from (0,0) to (1,1) whose control points
 * ARE the bezier's two handles, so `cubic-bezier(x1, y1, x2, y2)` is
 * `M0,0 C{x1},{y1} {x2},{y2} 1,1`. GSAP's built-in `power2.inOut` is a near
 * neighbour of this curve, not the same one, which is why CustomEase is here.
 */
CustomEase.create(REVEAL_EASE, "M0,0 C0.4,0 0.2,1 1,1");

/** Every card the reveal drives carries this class; see `globals.css`. */
const CARD_SELECTOR = ":scope > .reveal-clip";

function cardsIn(grid: HTMLElement): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>(CARD_SELECTOR));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * How many columns the grid is drawing, asked two ways because one of them
 * declines on one of the two surfaces.
 *
 * `TeamGrid`'s grid is a `<div>` and reports its used track list, so the cheap
 * read answers. `WeekSchedule`'s grid is its `<fieldset>`, which reports the
 * SPECIFIED `repeat(auto-fill, minmax(260px, 1fr))` back at every width even
 * fully laid out with its cards visibly in three columns — a fieldset's grid
 * formatting context lives on its anonymous content box. Measured in Chromium
 * at 393px and 1280px, not assumed. So the row-top count is not a defensive
 * fallback that never runs; it is what the matchup layout uses every time.
 */
function readColumns(grid: HTMLElement, cards: readonly HTMLElement[]): number {
  const declared = columnCountFrom(getComputedStyle(grid).gridTemplateColumns);
  if (declared > 0) return declared;
  return countColumnsByRow(cards.map((card) => card.getBoundingClientRect().top));
}

/**
 * The staggered clip-path reveal shared by both pick surfaces: each card wipes
 * upward from its own bottom edge as its row nears the bottom of the viewport,
 * and un-wipes if you scroll back up past that line.
 *
 * One hook rather than one per surface, because `TeamGrid` and `WeekSchedule`
 * are the same problem twice and a rule about how a card reveals should be
 * written once — the same argument `MyPicksClient` already makes for handing
 * both layouts the same derived pickability values.
 *
 * Cards are found by class under the grid rather than by walking `.children`,
 * and that is not fussiness: in `WeekSchedule` the grid element IS the
 * `<fieldset>`, whose first DOM child is its `<legend>`. Indexing off
 * `.children` there would shift every card by one, put the cascade permanently
 * out of phase with the rows, and mask a screen-reader-only element. The class
 * query also sidesteps `TeamGrid`'s `if (!card) return null`, where a React
 * index could disagree with the rendered position — and it is the rendered
 * position, not the array position, that decides which row a card is in.
 *
 * @param gridRef   The element carrying `display: grid`. Its direct
 *                  `.reveal-clip` children are the cards.
 * @param orderKey  A string that changes exactly when the rendered ORDER or
 *                  MEMBERSHIP of those cards changes — which is exactly when
 *                  `index % columns` stops describing the DOM. Keep it to that:
 *                  `MyPicksClient` re-renders both surfaces on every tap, and a
 *                  key that moved with the pick would rebuild 32 timelines each
 *                  time.
 */
export function useCardReveal(
  gridRef: RefObject<HTMLElement | null>,
  orderKey: string,
) {
  // Bumped only when a resize actually changes the column count, which is what
  // forces a rebuild with the new cascade. The value itself is never read.
  const [columnEpoch, setColumnEpoch] = useState(0);
  const columns = useRef(0);
  const built = useRef(false);

  useGSAP(
    () => {
      const grid = gridRef.current;
      if (!grid) return;

      const cards = cardsIn(grid);
      if (cards.length === 0) return;

      // The global reduced-motion rule in globals.css only zeroes CSS animation
      // and transition durations; GSAP writes inline styles on every rAF tick
      // and has to opt out itself, exactly as `WeekStrip`'s programmatic scroll
      // does. The `.reveal-clip` rule already unmasks these cards under
      // `reduce` — this is what keeps them unmasked if that rule ever moves.
      if (prefersReducedMotion()) {
        gsap.set(cards, { clipPath: REVEAL_SHOWN });
        return;
      }

      // Read here rather than from state: this is a layout effect, so the grid
      // is laid out and the count is available on the FIRST pass. Seeding it
      // from a passive effect instead would build the whole cascade at delay 0
      // and then immediately rebuild it — a visible double-wipe on every mount.
      // This also seeds the ref the resize observer below compares against.
      const cols = readColumns(grid, cards);
      columns.current = cols;

      // A REBUILD must not replay the cascade on a card the eye has already
      // watched arrive: `revertOnUpdate` strips the inline clip-path, so
      // without this, re-sorting the grid or crossing a breakpoint would wipe
      // every visible card again. Read every rect before creating any timeline,
      // so 32 measurements cost one layout flush rather than 32.
      const rebuild = built.current;
      built.current = true;
      const line = window.innerHeight - 100; // matches REVEAL_START
      const alreadyIn = rebuild
        ? cards.map((card) => card.getBoundingClientRect().top <= line)
        : [];

      cards.forEach((card, index) => {
        const timeline = gsap
          .timeline({
            scrollTrigger: {
              trigger: card,
              start: REVEAL_START,
              toggleActions: "play none none reverse",
            },
          })
          // The stagger is a POSITION in the timeline, not a tween `delay`: a
          // child placed at `t` is unambiguous about surviving `reverse`, where
          // a delay on a trigger-driven tween is not. Reversing walks back
          // through the wipe and then through empty time, which is what you
          // want — the card is already hidden by the time the delay is reached.
          //
          // `fromTo`, not `to`, because Chrome's computed clip-path collapses
          // `inset(100% 0 0 0)` to a three-value shorthand. Both ends are
          // spelled out so GSAP interpolates matching token counts.
          .fromTo(
            card,
            { clipPath: REVEAL_HIDDEN },
            { clipPath: REVEAL_SHOWN, duration: REVEAL_DURATION, ease: REVEAL_EASE },
            revealDelay(index, cols),
          );

        // `progress(1)`, not `play()`: ScrollTrigger has already played this one
        // if it is past the line, and what we want is for it to be *finished*.
        // Same layout effect as the revert above, so no paint sees the gap.
        if (alreadyIn[index]) timeline.progress(1);
      });
    },
    { scope: gridRef, dependencies: [columnEpoch, orderKey], revertOnUpdate: true },
  );

  // A breakpoint crossing changes how many cards share a row, and therefore
  // every delay. Watching the grid's own box rather than `window` is what makes
  // the equality check meaningful: a resize fires for a phone's URL bar sliding
  // away and for a dialog's scroll lock too, and neither changes the count.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion()) return;

    const observer = new ResizeObserver(() => {
      const cards = cardsIn(grid);
      if (cards.length === 0) return;
      const next = readColumns(grid, cards);
      if (next === columns.current) return;
      columns.current = next;
      setColumnEpoch((n) => n + 1);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridRef, orderKey]);

  // Both surfaces are rendered inside a child of `MyPicksClient`'s `.stagger`,
  // whose `reveal-up` starts at `translateY(12px)`. This hook builds in a layout
  // effect, i.e. while that transform is still applied, so every trigger's start
  // is measured 12px low and stays that way — ScrollTrigger caches starts and
  // does not recompute them on scroll.
  //
  // That is not the sub-pixel rounding it sounds like. Measured in Chromium at
  // 393x852: starts moved -492 to -504 after a refresh, and three cards sitting
  // above the trigger line stayed masked indefinitely without one. One refresh
  // when the entrance lands fixes all of them.
  //
  // `closest` rather than a prop, so neither pick surface has to know it is
  // inside a `.stagger`; if it ever isn't, this quietly does nothing.
  useEffect(() => {
    const settling = gridRef.current?.closest(".stagger > *");
    if (!settling) return;
    // animationend bubbles, so a descendant's animation landing first would
    // otherwise spend this listener on the wrong element.
    const onEnd = (event: Event) => {
      if (event.target === settling) ScrollTrigger.refresh();
    };
    settling.addEventListener("animationend", onEnd);
    return () => settling.removeEventListener("animationend", onEnd);
  }, [gridRef]);
}

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import {
  FADE_EASE,
  REVEAL_EASE,
  REVEAL_START,
  columnCountFrom,
  countColumnsByRow,
  planCardReveal,
  revealDelay,
  type Reveal,
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

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)`, by the same identity — the curve
 * `tailwind.config.ts` gives the `blur-in` token, so the matchup cards ease
 * exactly as the hero's own pieces do rather than merely near them.
 */
CustomEase.create(FADE_EASE, "M0,0 C0.16,1 0.3,1 1,1");

/**
 * The cards are the grid's direct children carrying the reveal's own class; see
 * `globals.css`, and `Reveal` in `card-reveal.ts` for why that class arrives
 * alongside the styles rather than being spelled out at the call site.
 */
function cardsIn(grid: HTMLElement, reveal: Reveal): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>(`:scope > .${reveal.className}`));
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
 *
 * `offsetTop` and not `getBoundingClientRect().top`, and that is load-bearing
 * now that a reveal can start at `scale(1.04)`. A rect is the TRANSFORMED box,
 * so an armed card reports a top ~2% of its height above a revealed one — about
 * 3px, which is outside `countColumnsByRow`'s 1px tolerance. Any rebuild that
 * lands mid-cascade, with some of the first row revealed and some not, would
 * truncate the run and answer 1 column for a grid drawing three, collapsing that
 * rebuild's stagger. `offsetTop` is layout-derived, so no transform reaches it,
 * and every card shares the `relative` shell as its offset parent. It retires
 * the `.stagger`-translate caveat in `countColumnsByRow`'s note too — that 12px
 * never touched a relative comparison, but it does not touch this one at all.
 */
function readColumns(grid: HTMLElement, cards: readonly HTMLElement[]): number {
  const declared = columnCountFrom(getComputedStyle(grid).gridTemplateColumns);
  if (declared > 0) return declared;
  return countColumnsByRow(cards.map((card) => card.offsetTop));
}

/**
 * The staggered scroll reveal shared by both pick surfaces: each card arrives as
 * its row nears the bottom of the viewport, a tenth of a second behind the card
 * to its left, once.
 *
 * WHAT arriving looks like is the caller's — `REVEAL_CLIP` wipes a mask upward
 * from the card's own bottom edge (`TeamGrid`), `REVEAL_FADE` resolves it out of
 * a blur (`WeekSchedule`, matching the pick module above it). WHEN it happens is
 * this hook's, and is identical for both.
 *
 * One hook rather than one per surface, because `TeamGrid` and `WeekSchedule`
 * are the same problem twice and a rule about when a card reveals should be
 * written once — the same argument `MyPicksClient` already makes for handing
 * both layouts the same derived pickability values. Every branch below reads the
 * `Reveal` and none of them tests which one it got.
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
 * The reveal is ONE-WAY. A card wipes in the first time its row crosses the
 * trigger line and then stays: scrolling back up and down again must not replay
 * it. `planCardReveal` in `card-reveal.ts` owns the three-way decision, and the
 * one exception is a week change — see there.
 *
 * @param gridRef   The element carrying `display: grid`. Its direct children
 *                  carrying `reveal.className` are the cards.
 * @param reveal    Which reveal, whole — see `Reveal` in `card-reveal.ts`. The
 *                  card's class comes off this same object, so the two cannot
 *                  drift apart.
 * @param weekKey   Changes only when the viewed week changes. This is the ONE
 *                  thing that makes a card animate a second time.
 * @param orderKey  Changes when the rendered ORDER or MEMBERSHIP of the cards
 *                  changes — which is exactly when `index % columns` stops
 *                  describing the DOM. Rebuilds the cascade, animates nothing.
 *                  Keep it to that: `MyPicksClient` re-renders both surfaces on
 *                  every tap, and a key that moved with the pick would rebuild
 *                  32 timelines each time.
 */
export function useCardReveal(
  gridRef: RefObject<HTMLElement | null>,
  { reveal, weekKey, orderKey }: { reveal: Reveal; weekKey: string; orderKey: string },
) {
  // Bumped only when a resize actually changes the column count, which is what
  // forces a rebuild with the new cascade. The value itself is never read.
  const [columnEpoch, setColumnEpoch] = useState(0);
  const columns = useRef(0);

  // Which cards have already wiped in. Read rather than derived from position,
  // because with a one-way reveal the two are no longer the same fact — a card
  // revealed on the way down and then scrolled back below the line is still
  // revealed. A WeakSet rather than a Set: `WeekSchedule` replaces every card
  // node on a week change, and a Set would hold the detached ones forever.
  const revealed = useRef(new WeakSet<Element>());

  // Null until the first build, which is what makes a mount not a week change.
  const lastWeek = useRef<string | null>(null);

  useGSAP(
    () => {
      const grid = gridRef.current;
      if (!grid) return;

      const cards = cardsIn(grid, reveal);
      if (cards.length === 0) {
        // The silent failure this hook has always had one way to reach and now
        // has two: move the class off the direct child, or hand a surface one
        // reveal's class and the other's styles, and the query finds nothing,
        // this returns before writing a style, and `globals.css` leaves every
        // card at its invisible start state. Nothing throws; typecheck and the
        // suite stay green; the page is simply blank where the grid was. A grid
        // with children but no cards is never legitimate, so say so — stripped
        // from the production bundle, which is why it can be this chatty.
        if (process.env.NODE_ENV !== "production" && grid.children.length > 1) {
          console.warn(
            `[useCardReveal] ${grid.children.length} children under the grid but no ".${reveal.className}" cards. ` +
              "The class must be on the grid's DIRECT children and must match the reveal passed in, " +
              "or they stay at their start state and never appear.",
          );
        }
        return;
      }

      // The global reduced-motion rule in globals.css only zeroes CSS animation
      // and transition durations; GSAP writes inline styles on every rAF tick
      // and has to opt out itself, exactly as `WeekStrip`'s programmatic scroll
      // does. The start-state rules already resolve these cards under `reduce` —
      // this is what keeps them resolved if one of those rules ever moves.
      if (prefersReducedMotion()) {
        gsap.set(cards, reveal.shown);
        return;
      }

      // Read here rather than from state: this is a layout effect, so the grid
      // is laid out and the count is available on the FIRST pass. Seeding it
      // from a passive effect instead would build the whole cascade at delay 0
      // and then immediately rebuild it — a visible double-wipe on every mount.
      // This also seeds the ref the resize observer below compares against.
      const cols = readColumns(grid, cards);
      columns.current = cols;

      const weekChanged = lastWeek.current !== null && lastWeek.current !== weekKey;
      lastWeek.current = weekKey;

      // Both snapshots are taken BEFORE the loop, for two different reasons.
      //
      // Membership, because ScrollTrigger evaluates position at creation and
      // fires `onEnter` synchronously for a card already past the line — so
      // reading the set inside the loop would mark a card "already revealed"
      // during the very build that is revealing it for the first time.
      //
      // Rects, because the branches below write inline styles, and interleaving
      // reads with writes turns one layout flush into 32.
      const wasRevealed = cards.map((card) => revealed.current.has(card));
      const line = window.innerHeight - 100; // matches REVEAL_START
      const aboveLine = cards.map((card) => card.getBoundingClientRect().top <= line);

      cards.forEach((card, index) => {
        const at = revealDelay(index, cols);
        const plan = planCardReveal({
          weekChanged,
          wasRevealed: wasRevealed[index] ?? false,
          aboveLine: aboveLine[index] ?? false,
        });

        if (plan.kind === "hold") {
          // Revealed is terminal, so this one is given no trigger at all: a
          // rebuild after a full scroll-through arms nothing. (Without a
          // rebuild, `once` retires each trigger only as its card passes the
          // trigger's `end`, so some outlive the wipe — measured at 2 to 11
          // still live across the four widths.)
          gsap.set(card, reveal.shown);
          return;
        }

        if (plan.kind === "replay") {
          const timeline = gsap.timeline({ delay: at });

          if (plan.wipeOut) {
            // `revertOnUpdate` has already stripped the inline clip-path by the
            // time this callback runs, so without putting it back the wipe-away
            // would animate hidden -> hidden. Safe here and nowhere else: this
            // is a layout effect, so no paint falls between the revert and the
            // set. It cleans itself up too — a `gsap.set` inside a `useGSAP`
            // callback is a zero-duration Tween on the context, so the next
            // revert removes the property again.
            //
            // An explicit forward tween rather than `timeline.reverse()`:
            // reversing a tween reverses its easing curve as well, which is the
            // same argument `tailwind.config.ts` makes for `drawer-down` being
            // its own keyframe.
            gsap.set(card, reveal.shown);
            timeline.to(card, {
              ...reveal.hidden,
              duration: reveal.replayOut,
              ease: reveal.ease,
            });
          }

          // `immediateRender: false` is the whole wipe-away. A `fromTo` renders
          // its FROM state at creation by default, even sitting last in a
          // timeline — so without this the card is stamped to hidden before the
          // tween above ever runs, the wipe-away plays invisibly against an
          // already-hidden card, and a week change snaps instead of animating.
          // Which is the bug this replay exists to fix, reintroduced one line
          // further down. Measured: the card read `inset(100% 0% 0%)` at 0ms and
          // did not move until 400ms.
          timeline.fromTo(card, reveal.hidden, {
            ...reveal.shown,
            duration: reveal.replayIn,
            ease: reveal.ease,
            immediateRender: false,
          });

          // No ScrollTrigger: it is on screen and ends revealed either way.
          revealed.current.add(card);
          return;
        }

        // Armed: masked, waiting for its row to cross the line.
        revealed.current.delete(card);
        gsap
          .timeline({
            scrollTrigger: {
              trigger: card,
              start: REVEAL_START,
              // THIS is what stops the replay, not `once` below. ScrollTrigger's
              // toggle-action block never consults `once` — with
              // "play none none reverse" a card un-wipes on the way back up and
              // re-wipes on the way down, `once` or not. With nothing on the
              // other three actions, scrolling up does nothing and re-entering
              // calls `play()` on a timeline already at progress 1, which is a
              // no-op. (The default is `"play"`, i.e. the same thing; it is
              // spelled out so the change from the old value is legible.)
              toggleActions: "play none none none",
              // `once` earns its place for a different reason: it retires the
              // trigger as the card scrolls past, and its `kill(false, 1)`
              // passes revert=false and allowAnimation=truthy, so the tween is
              // left exactly where it is. A bare `.kill()` does the opposite —
              // it reverts the styles and kills the animation.
              once: true,
              onEnter: () => revealed.current.add(card),
            },
          })
          // The stagger is a POSITION in the timeline, not a tween `delay`, so
          // it survives however the timeline is later driven.
          //
          // `fromTo`, not `to`, because Chrome's computed clip-path collapses
          // `inset(100% 0 0 0)` to a three-value shorthand. Both ends are
          // spelled out so GSAP interpolates matching token counts. The fade
          // wants the same treatment for the same reason one level down: GSAP
          // has no filter parser, so `filter` is interpolated as a string and
          // both ends have to be given, not read back off the element.
          .fromTo(
            card,
            reveal.hidden,
            { ...reveal.shown, duration: reveal.reveal, ease: reveal.ease },
            at,
          );
      });
    },
    // `reveal` is a module-level constant on both call sites, so it is here for
    // honesty rather than to trigger anything — a surface does not switch its
    // reveal at runtime, and if one ever did, this is what would rebuild it.
    {
      scope: gridRef,
      dependencies: [columnEpoch, weekKey, orderKey, reveal],
      revertOnUpdate: true,
    },
  );

  // A breakpoint crossing changes how many cards share a row, and therefore
  // every delay. Watching the grid's own box rather than `window` is what makes
  // the equality check meaningful: a resize fires for a phone's URL bar sliding
  // away and for a dialog's scroll lock too, and neither changes the count.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion()) return;

    const observer = new ResizeObserver(() => {
      const cards = cardsIn(grid, reveal);
      if (cards.length === 0) return;
      const next = readColumns(grid, cards);
      if (next === columns.current) return;
      columns.current = next;
      setColumnEpoch((n) => n + 1);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridRef, orderKey, reveal]);

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

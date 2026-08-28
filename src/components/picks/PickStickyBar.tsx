"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Label } from "@/components/ui/Label";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import type { TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";
import { H4 } from "@/lib/type-scale";
import { eyebrowFor, heroScrolledPast, matchupLine, resolvePick, stripGradient } from "./pick-hero";

/**
 * The pick module, condensed to one 89px row and pinned to the top of the
 * screen once the real one has scrolled away.
 *
 * It exists because the phone layout is a long scroll — week strip, pick module,
 * layout filters, then 32 team cards — so by the time you are choosing a team,
 * the module telling you who you already picked is far off screen. On this page
 * that is not a convenience: a tap spends a team for the season.
 *
 * Mobile only (`lg:hidden`), because from `lg` the whole page fits differently
 * and `AppHeader` owns the top edge. Below `lg` there is no top chrome at all,
 * so this competes with nothing.
 *
 * **It portals to `document.body`, and that is not optional.** Two independent
 * reasons, and the second is the harder one:
 *
 *   1. `MyPicksClient`'s root is `.stagger`, and `globals.css` gives every
 *      direct child `reveal-up 0.5s both` at an `:nth-child` delay of up to
 *      385ms — a bar rendered inline would sit invisible through its own slide.
 *      This is the reason `Toast` and `Drawer` already give.
 *   2. That animation's fill-mode is `both`, so the final keyframe's
 *      `transform: translateY(0)` is **retained for the life of the page**.
 *      `translateY(0)` is not `none`, and any non-`none` transform makes its
 *      element a containing block for `position: fixed` descendants. So a fixed
 *      bar rendered ANYWHERE inside `.stagger` — not merely as a direct child —
 *      would be pinned to that block instead of to the viewport, permanently.
 *      Rendering it inside the grid's `mt-4` wrapper to avoid renumbering the
 *      `:nth-child` delays looks clever and does not work.
 *
 * Portalling also means it contributes no node to `.stagger` at all, so it
 * renumbers no sibling's delay.
 *
 * Deliberately NOT reusing `BlurReveal`. The hero re-forms in sixteen staggered
 * pieces over 650ms because it is the page's headline; this is an 89px strip
 * that arrives every time you scroll past it, and it should read as one object
 * sliding in rather than as sixteen words assembling. Don't "complete" it later.
 */
export function PickStickyBar({
  weekName,
  teamId,
  game,
  anchor,
}: {
  /** Short week label — "WK6", "HOF", "P2". `weekShortName`, not `weekLabel`. */
  weekName: string;
  teamId: TeamId | null;
  game: Game | undefined;
  /** `PickHero`'s root `<section>`. Null until it mounts. */
  anchor: HTMLElement | null;
}) {
  const [visible, setVisible] = useState(false);

  // `document` is absent on the server pass, so the portal target has to wait
  // for mount — the same gate `Toast` uses.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
    An IntersectionObserver, and this repo's first — chosen over ScrollTrigger,
    which is already in this route's bundle, for one decisive reason:
    **ScrollTrigger caches start positions and IO caches nothing.**

    `use-card-reveal.ts` measures what that costs inside `.stagger`: starts came
    out 12px low because `reveal-up` begins at `translateY(12px)`, and three
    cards stayed masked *indefinitely* without a manual `ScrollTrigger.refresh()`
    wired to an `animationend`. IO sees the same 12px and self-corrects on the
    next layout change. On this page the hero also genuinely moves after first
    paint — the preseason banner mounts and unmounts above it — and every one of
    those would need another refresh.

    Note what is NOT an argument for it: reduced motion. That is a property of
    how you animate, not how you detect scroll, and the CSS transition below
    would get the global clamp either way.

    `threshold: 0` against the viewport, and the observer fires once immediately
    on `observe()` — so a load with restored scroll gets the right initial state
    without a scroll event. Anchoring on the viewport's TOP edge also means
    mobile Safari's URL bar collapsing, which changes viewport height, can never
    move the trigger.
  */
  useEffect(() => {
    if (!anchor) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(heroScrolledPast(entry.boundingClientRect));
      },
      { threshold: 0 },
    );
    io.observe(anchor);
    return () => io.disconnect();
  }, [anchor]);

  // Every hook above any early return. `resolvePick` is the same test `PickHero`
  // makes before falling through to `NoPickHero`, so the two can never disagree
  // about whether a pick exists.
  const view = resolvePick(teamId, game);
  if (!view || !teamId || !mounted) return null;
  const { team, game: pickGame } = view;

  return createPortal(
    /*
      A CSS transition, not a keyframe pair, and the reason is INTERRUPTION. The
      trigger is a scroll position the user oscillates around — a thumb-flick
      near the hero's bottom edge crosses it twice in 300ms. A class-swapped CSS
      animation restarts from its own first keyframe every time the class
      changes, so re-crossing mid-slide would snap the bar back off screen and
      replay; a transition reverses smoothly from wherever it currently is.

      `Drawer` and `Toast` use keyframe pairs because they mount and unmount and
      need the element to survive its own exit — a third `rendered` state, an
      `animationend` listener and a `setTimeout` backstop. This bar is mounted
      continuously for as long as a pick exists, so none of that machinery buys
      anything here.

      Their asymmetry is still honoured, because a transition can carry it: 320ms
      in, 280ms out, the same pair as `drawer-up`/`drawer-down` and
      `toast-in`/`toast-out`, stated per branch rather than as a reversed
      direction — which would reverse the easing curve with it.

      `-translate-y-full`, never a pixel value: a translate percentage resolves
      against the element's own border box, so the bar clears the viewport
      exactly at every safe-area inset without a magic number to keep in sync.
    */
    <div
      /*
        aria-hidden permanently, not conditionally. Every string in here is a
        verbatim restatement of `PickHero`, which is not removed when this
        appears — only scrolled above the fold — so it is still in the
        accessibility tree with the same six strings. A screen reader navigates
        by structure, not by scroll offset, so a second copy is noise; and
        portalled to the end of `body` while painting at the top of the screen,
        it would read detached from everything it describes.

        This is legal only because nothing inside is focusable — aria-hidden over
        a focusable element is a WCAG failure, since a keyboard user can reach
        something no AT can name. Audit before changing: three strip spans, the
        logo wrapper, an <img>, two <span>s from `Label`, a <p>, a <span> and two
        <time>s. **If this ever becomes tappable, the aria-hidden must come off
        and this whole analysis reopens.** There is a test pinning the pair.

        No `role`, and specifically not `role="status"`: `Toast` is a status
        because it announces something that just happened, once. This is
        persistent chrome whose appearance is driven by scrolling, and a live
        region would announce the team on every crossing.
      */
      aria-hidden
      className={cn(
        "fixed inset-x-0 top-0 z-30 border-b border-shell-line bg-bg/80 backdrop-blur-sm lg:hidden",
        // Portalled to `body`, so it inherits nothing from the shell's own
        // safe-area padding and must add its own. On the outer element, so the
        // white runs up through the status-bar inset to the screen edge —
        // exactly as `BottomTabBar` puts its inset padding on its outer element.
        "pt-[env(safe-area-inset-top)]",
        // z-30 is the app-chrome tier `BottomTabBar` and `AppHeader` share: above
        // `StandingsGrid`'s sticky in-table layer, below the overlay tier that
        // Drawer, Modal and Toast use. Do not promote it into that tier — the bar
        // would then paint over a dialog scrim. (Spelled in prose rather than as
        // the class: Tailwind scans comments, so naming a class this file does
        // not use would ship its rule anyway.)
        "transition-transform ease-[cubic-bezier(0.22,1,0.36,1)]",
        visible ? "translate-y-0 duration-[320ms]" : "-translate-y-full duration-[280ms]",
        // No `pointer-events-none`, and that INVERTS `Toast`. Toast disables them
        // because it is a full-width positioner around a small card; this is the
        // full-width surface itself, and a tap falling through it would land on a
        // team card the reader cannot see — which on this page spends a team for
        // the season. It must swallow taps. Off screen it is unhittable anyway.
      )}
    >
      {/* h-[89px] with `items-center`, not padding: the frame states the height
          outright and centres a 67px container in it (11px each side). Letting
          it fall out of `py-2` gave 83 once the matchup block dropped to 12px,
          and the bar's height is also its slide distance. */}
      <div className="mx-auto flex h-[89px] max-w-shell items-center px-4">
        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
          <Label>{eyebrowFor(weekName)}</Label>

          {/* h-[51px] rather than letting the matchup stack set it: the bar must
              be the same height for every team, or the slide distance changes
              with the pick. Same invariant `PickHero`'s fixed row height keeps,
              and it is what lets the strips and the rule take `h-full`. The 51
              IS the matchup stack's own height (3 x 12px at 1.4 = 50.4), so the
              two agree — but only one of them is allowed to decide it. */}
          <div className="flex h-[51px] items-center gap-2">
            {/* 3 × 12 + 2 × 4 = 44 wide, per the frame. `isolate` scopes the
                logo's z-10 to this group. */}
            <div className="relative isolate flex h-full shrink-0 items-center gap-1">
              <span
                className="h-full w-3 rounded-sm"
                style={{ backgroundImage: stripGradient(team.color, "down") }}
              />
              <span
                className="h-full w-3 rounded-sm"
                style={{ backgroundImage: stripGradient(team.color, "up") }}
              />
              <span
                className="h-full w-3 rounded-sm"
                style={{ backgroundImage: stripGradient(team.color, "down") }}
              />
              {/*
                `w-max` here is PROPHYLAXIS, and it was measured rather than
                assumed. The failure it guards is real: this span is absolutely
                positioned with a `left` and no width, so it shrink-to-fits into
                the 22px between `left: 50%` and the 44px group's right edge, and
                a 36px logo then draws 22 wide by 36 tall while
                `-translate-x-1/2` shifts it by half of 22 — landing it 11px in
                instead of 4 and overhanging the strips. That is the same bug
                CLAUDE.md records for `PickHero`'s 80px logo drawing 50 wide.

                But `w-max` and `TeamLogo`'s baked-in `max-w-none` are REDUNDANT
                with each other, and only removing BOTH reproduces it. Measured
                in Chromium at both geometries — this 36-in-44, and PickHero's
                80-in-68 — all four combinations: 36/36/36/22. Either class alone
                is sufficient, because they defeat the same clamp from opposite
                ends (one removes preflight's `max-width: 100%` from the image,
                the other makes the wrapper a definite width so shrink-to-fit
                never runs). Kept because it costs nothing and a future call site
                could drop `TeamLogo` for a bare `<img>`; do not describe it as
                load-bearing.

                One `TeamLogo`, where `PickHero` needs three: `size` is an inline
                style no breakpoint class can reach, and this component only ever
                exists below `lg`, at one size.
              */}
              <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-max -translate-x-1/2 -translate-y-1/2">
                <TeamLogo teamId={teamId} size={36} />
              </span>
            </div>

            <div className="flex h-full min-w-0 items-center gap-2.5">
              <div className="flex flex-col justify-center whitespace-nowrap py-1">
                <Label>{team.location}</Label>
                {/* A paragraph, never a heading element: an aria-hidden
                    heading is invisible today, but a duplicate of the hero's
                    level-1 heading would corrupt heading-jump navigation the
                    moment the aria-hidden came off. */}
                <p className={cn(H4, "text-shell-ink")}>{team.name}</p>
              </div>

              <div className="h-full w-px shrink-0 bg-shell-line" />

              {/* Body 12 — 12px over 1.4 at -1%, in the PRIMARY ink, so it is
                  darker than the city label above it rather than lighter. That
                  is the design's call and it pairs with the translucent
                  background above: at #858585 this line measured 3.5:1 on solid
                  white and would have lost contrast the moment the fill let the
                  page through; #1E1E1E clears 16:1 with room to spare.

                  The slash shorthand, not `text-[12px] leading-[1.4]` — a
                  `text-*` utility carries a line-height of its own, so a separate
                  `leading-*` can be beaten by a later-emitted `text-*`. Matches
                  `PickHero`'s `Meta`, which documents the trap. Tracking as
                  `-0.01em`, not `-0.12px`: Figma reports letter-spacing as
                  percent × 100, and `em` is that percentage directly — which is
                  why this class did NOT have to change when the size did, where
                  a pixel value would have. */}
              <div className="flex h-full flex-col justify-center whitespace-nowrap text-[12px]/[1.4] font-medium tracking-[-0.01em] text-shell-ink">
                <span>{matchupLine(pickGame, teamId, "long")}</span>
                <LocalTime iso={pickGame.kickoff} mode="date" />
                <LocalTime iso={pickGame.kickoff} mode="clockzone" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_TABS, isActive } from "./nav";

/**
 * The app's navigation below `lg`: a pill floating at the foot of the viewport
 * carrying all three destinations as text buttons. `AppHeader` is hidden at
 * these widths, so this is the only chrome a phone gets — the design gives the
 * top of the screen back to the page entirely.
 *
 * **It is `HeaderNav`'s pill, at the other edge.** Same white fill, hairline
 * border, drop shadow and 16px buttons off the same `NAV_TABS`, and the same
 * three inks. Four differences, all from the frame: no app mark, `px-3` on the
 * pill rather than `px-4`, no gap between the buttons, and the row's vertical
 * padding inverted (`pt-1 pb-2` against the header's `pt-2 pb-1`). Anything that
 * changes the look of one and not the other is a bug unless a frame says
 * otherwise.
 *
 * `lg` (1024px) rather than `md` because that is the app's single turn-over
 * width: `WeekStrip`, `StandingsGrid`, `PickHero`, `TeamGrid` and the account
 * grid all change shape there and nothing changes at `md`.
 *
 * `sticky bottom-0`, NOT `fixed`, and that is the load-bearing choice. As the
 * last child of the layout's `min-h-dvh flex-col` wrapper, this element's flow
 * position IS the foot of the document — `bottom: 0` only ever shifts a sticky
 * box up toward the viewport, never down, so it paints at the viewport's bottom
 * edge at every scroll offset and, at full scroll, is simply sitting where it
 * lives. On a short page `main`'s `flex-1` stretches the column to a full `dvh`
 * and the bar lands at the bottom with no offset at all.
 *
 * The payoff is that it also RESERVES its height at the document foot, so
 * `main`'s `pb-20 lg:pb-32` needed no renegotiation — the number that moved
 * twice in this layout's history (`pb-28` under the old fixed bar, then `pb-12`)
 * did not have to move a third time, and the page-frame measurement in
 * CLAUDE.md still reads 40/80 and 64/128. Content still passes BEHIND the pill
 * mid-scroll; what cannot happen is content stranded underneath it at the
 * bottom of the page.
 *
 * No portal, unlike `Drawer` and `Toast`. Those portal because their callers
 * render inside a `.stagger` root, whose `> *` rule would hand a fixed root a
 * `reveal-up` delay. This is a sibling of `<main>` in the layout, not a
 * `.stagger` child — but it must stay there: moving it inside a page root would
 * pick that rule up, and portalling it would put it outside `max-w-shell` and
 * force `fixed`, dragging the padding renegotiation back in.
 */
export function BottomTabBar({
  buyInUnpaid = false,
}: {
  buyInUnpaid?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      /*
        `pb-[env(safe-area-inset-bottom)]` on the OUTER element, not on the row
        and not folded into `--tab-bar-h`. Two consequences, both wanted: the
        70px row sits entirely above the home indicator so the design height is
        preserved rather than eaten, and the flow space the bar reserves grows by
        the inset too, so clearance stays right in standalone mode for free.
        `src/app/layout.tsx` sets `viewportFit: "cover"`, so the inset is a real
        value there.

        This element carries no fill of its own — the pill has one — so the
        gutters beside it, the 4px above, the 8px below and the home-indicator
        strip are all transparent, and page content scrolls behind them.

        **Taps are still swallowed here, unlike the desktop header**, and the
        reason has changed even though the answer hasn't. `AppHeader` opts out
        with `pointer-events-none` because it spans 1000px while drawing ~400.
        This bar's undrawn band is ~28px per side — small, at the very bottom
        edge where a thumb rests, and on the picks page a tap falling through to
        a team card spends that team for the season. A dead 28px strip in the
        bottom corners is the cheaper mistake. That is a deliberate divergence
        from the header, not an oversight.

        `AppHeader` carries the same `aria-label="Primary"`. Two identically
        named landmarks in one document would be a real problem — but both hides
        are `display: none` (`hidden` there, `lg:hidden` here), which removes the
        element from the accessibility tree outright, so exactly one is ever
        exposed. Swapping either for `sr-only`, `visibility` or an opacity trick
        would break that.
      */
      className="sticky bottom-0 z-30 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/*
        `h-[var(--tab-bar-h)]` AND the frame's asymmetric padding, which agree
        under `border-box`: 4 + 58 + 8 = 70. The height is pinned by the one
        number `Toast` also clears, and the padding places the pill inside it —
        rather than letting the height fall out of the content, which is how the
        sticky pick module silently shrank to 83px when its type got smaller.

        `z-30` is the app-chrome tier `AppHeader` already occupies, which is what
        puts this above `StandingsGrid`'s `sticky z-20` header row and below the
        `z-50` overlays. `main` is unpositioned and the shell wrapper is
        `relative` at `z-index: auto`, so neither opens a stacking context and
        those all compare directly in the root one.
      */}
      <div className="flex h-[var(--tab-bar-h)] items-center justify-center px-3 pb-2 pt-1">
        {/*
          The pill: 337 × 58 at the frame's widths — 1 + 12 + 100 + 111 + 100 +
          12 + 1. `shrink-0` is what makes it HUG rather than stretch, so a large
          phone or a tablet gets the same pill centred rather than a bar reaching
          both edges. That is the one thing the old full-width track got worst:
          at 1023px it drew three 325px tabs.

          Solid white with a hairline border and a drop shadow, exactly the
          header's card. It is NOT the frosted treatment this bar used to carry,
          and it no longer matches `PickStickyBar`, which stays frosted — so on
          the picks page a translucent bar sits at the top and this solid pill at
          the foot. That split was decided rather than drifted into.

          It must not take `overflow-hidden`: the global focus ring draws 4px
          beyond a button and the pill's padding accommodates it on every side.
        */}
        <div
          className={cn(
            "flex shrink-0 items-center rounded-card border border-shell-line/50 bg-white",
            "px-3 py-2 shadow-[0_6px_6px_rgba(0,0,0,0.08)]",
          )}
        >
          {NAV_TABS.map(({ key, href, label }) => {
            const active = isActive(href, pathname);
            const dot = key === "account" && buyInUnpaid;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                /*
                  The dot is a purely visual badge, so its one fact is spelled
                  into the accessible name — verbatim the string `HeaderNav`
                  uses, so the same thing reads the same way in both navs. WCAG
                  2.5.3 Label in Name holds because the visible "Account" is a
                  substring of it; when paid there is no label at all and the
                  name comes from the visible text, which is the arrangement
                  `MoreSection`'s copy button still gets wrong.
                */
                aria-label={dot ? "Account — buy-in unpaid" : undefined}
                className={cn(
                  "relative flex h-10 items-center justify-center whitespace-nowrap",
                  "rounded-control px-3 text-base font-semibold leading-[1.2] transition-colors",
                  // 40px drawn, 44px tapped. 2px each way reaches this repo's
                  // `.tap-target` floor without moving the drawn box, and it
                  // lands inside the pill's own `py-2` so it can never overhang.
                  //
                  // `inset-x-0`, never a full `-inset`: the buttons are adjacent
                  // with NO gap, so any horizontal extension would overlap its
                  // neighbour and steal that button's taps.
                  //
                  // The header deliberately does NOT do this — the floor is a
                  // touch guideline and that surface is pointer-driven, which
                  // the last redesign said out loud when it dropped the ring
                  // from the old account circle. This surface is the one the
                  // floor exists for.
                  "after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
                  // The frame's 100px minimum and 16px padding hold from 375px
                  // up, which covers every width it draws. Below that they do
                  // not fit: 2 + 24 + 100 + 110 + 100 = 336 against the 336 a
                  // 360px viewport leaves after this row's `px-3`, i.e. a
                  // rounding error rather than slack, and 40px short at 320.
                  // Under 375 the buttons take their content width at `px-3`
                  // instead, which brings the pill to ~278 and overflows
                  // nothing. Beyond the frame, which is 393 wide.
                  "min-[375px]:min-w-[100px] min-[375px]:px-4",
                  // Three inks across three states, each stated as a complete
                  // branch rather than a base this overrides — the design uses
                  // two different blacks (#000 selected, #1E1E1E on hover) and a
                  // base colour overridden here would make correctness rest on
                  // tailwind-merge resolving two `text-{color}` classes
                  // last-wins, which is the behaviour `Label.tsx` has already
                  // been bitten by.
                  //
                  // `hover:` belongs INSIDE the unselected branch: a hover ink
                  // and a base ink sit in different tailwind-merge groups, so
                  // both would survive in the shared string — and hovering the
                  // SELECTED button would then drop it from #000 to #1E1E1E.
                  //
                  // The selected fill is `fill-soft` #F3F3F3 where the frame
                  // says #F5F5F5 — that hex is Figma's Simple Design System
                  // hover token and has no home in this palette, and `fill-soft`
                  // is 2/255 away. The same token the header uses, which is now
                  // the point: the two navs agree.
                  active
                    ? "bg-fill-soft text-black"
                    : "text-shell-mute hover:text-shell-ink",
                )}
              >
                {label}
                {/*
                  2px in from the button's top-right, the frame's offset taken
                  directly — this button has no border, so an absolutely
                  positioned child resolves against a padding box that IS its
                  border box and the naive arithmetic is right. (The old round
                  account circle needed a different number for the same 2px,
                  because it had one.)

                  Nothing in this subtree may take `overflow-hidden`.
                */}
                {dot ? (
                  <span
                    aria-hidden
                    className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-badge-due"
                  />
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

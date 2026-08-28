"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { CheckCircleIcon, GridIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { NAV_TABS, type TabKey, isActive } from "./nav";

/**
 * The app's navigation below `lg`: a bar pinned to the foot of the viewport
 * carrying all three destinations as equal thirds. `AppHeader` is hidden at
 * these widths, so this is the only chrome a phone gets — the design gives the
 * top of the screen back to the page entirely.
 *
 * `lg` (1024px) rather than `md` because that is the app's single turn-over
 * width: `WeekStrip`, `StandingsGrid`, `PickHero`, `TeamGrid` and the account
 * grid all change shape there and nothing changes at `md`. From `lg` up this is
 * `display: none` and the header's pill is back, unchanged.
 *
 * `sticky bottom-0`, NOT `fixed`, and that is the load-bearing choice. As the
 * last child of the layout's `min-h-dvh flex-col` wrapper, this element's flow
 * position IS the foot of the document — `bottom: 0` only ever shifts a sticky
 * box up toward the viewport, never down, so it paints at the viewport's bottom
 * edge at every scroll offset and, at full scroll, is simply sitting where it
 * lives. On a short page `main`'s `flex-1` stretches the column to a full `dvh`
 * and the bar lands at the bottom with no offset at all.
 *
 * The payoff is that it also RESERVES its 64px at the document foot, so
 * `main`'s `pb-20 lg:pb-32` needed no renegotiation — the number that moved
 * twice in this layout's history (`pb-28` under the old fixed bar, then `pb-12`)
 * did not have to move a third time, and the page-frame measurement in
 * CLAUDE.md still reads 40/80 and 64/128. Content still passes BEHIND the
 * translucent track mid-scroll, exactly as it does behind the header; what
 * cannot happen is content stranded underneath it at the bottom of the page.
 *
 * No portal, unlike `Drawer` and `Toast`. Those portal because their callers
 * render inside a `.stagger` root, whose `> *` rule would hand a fixed root a
 * `reveal-up` delay. This is a sibling of `<main>` in the layout, not a
 * `.stagger` child — but it must stay there: moving it inside a page root would
 * pick that rule up, and portalling it would put it outside `max-w-shell` and
 * force `fixed`, dragging the padding renegotiation back in.
 */

/*
  A `Record` over the key union rather than a lookup with a fallback: a fourth
  destination added to `nav.ts` fails to COMPILE here until it has a glyph,
  instead of rendering a hole.

  `GridIcon` is already the design's 2×2 rounded-square grid and `UserIcon` is
  already its person outline, so both are reused verbatim — this bar is what
  gives `GridIcon` its first call site. Only the tick-in-a-circle had no
  equivalent (`CheckIcon` is the bare tick) and was added to `icons.tsx`.
*/
const ICON: Record<TabKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  picks: CheckCircleIcon,
  standings: GridIcon,
  account: UserIcon,
};

export function BottomTabBar({ buyInUnpaid = false }: { buyInUnpaid?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      /*
        `pb-[env(safe-area-inset-bottom)]` on the OUTER element, not on the row
        and not folded into `--tab-bar-h`. Two consequences, both wanted: the
        64px row sits entirely above the home indicator so the design height is
        preserved rather than eaten, and the flow space the bar reserves grows by
        the inset too, so clearance stays right in standalone mode for free.
        `src/app/layout.tsx` sets `viewportFit: "cover"`, so the inset is a real
        value there.

        This element carries NO fill and NO blur — both moved onto the track
        below. So the 12px gutters, the 4px above and below it, and the
        home-indicator strip are all fully transparent, and page content scrolls
        behind them unobscured. That is the floating-pill reading the design
        asks for; it also means the inset strip is a bare band on a notched
        phone rather than chrome, which is the one thing here the 393×64 frame
        cannot show.

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
        Geometry, so nobody re-derives it at 393px: the row is `--tab-bar-h`
        (64) less `py-1` (4 + 4) → a 56px track; `px-3` leaves it 393 − 24 = 369
        wide; three `flex-1` tabs make that 123 each. The tab's own content
        agrees independently — 8 (py-2) + 20 (icon) + 8 (gap-2) + 12 (label at
        `leading-none`) + 8 = 56.

        No `items-*` on this row: flexbox's default `stretch` is what gives the
        track its 56px. `items-center` would size it to its content — the same
        56 today, and wrong the moment a label wraps.

        `z-30` is the app-chrome tier `AppHeader` already occupies, which is what
        puts this above `StandingsGrid`'s `sticky z-20` header row and below the
        `z-50` overlays. `main` is unpositioned and the shell wrapper is
        `relative` at `z-index: auto`, so neither opens a stacking context and
        those all compare directly in the root one.
      */}
      <div className="flex h-[var(--tab-bar-h)] px-3 py-1">
        {/*
          The fill and the blur both live HERE, not on the bar, so only the
          rounded track frosts what is behind it — `bg-bg/80` is the page colour
          at 80%, the same pair the sticky pick module takes at the other edge of
          the screen, so the two pieces of mobile chrome read as one material.
          (`80` is on Tailwind's opacity scale; `12` famously is not, which is
          why `AppHeader` spells its own fill as an arbitrary value.)

          Figma gives the track `overflow-clip`; it is deliberately not
          transcribed, and moving the blur here does not change that. A
          `backdrop-filter` is clipped to its own element's border box —
          `rounded-card` and all — so the frosting rounds without any help.
          There is otherwise nothing to clip, since the active tab carries the
          track's own 16px radius and an end tab's outer corners coincide with
          it exactly; and an overflow here WOULD clip the global
          `:focus-visible` ring's `ring-offset-2` on the first and last tab. It
          is the `overflow-hidden`-near-a-notification-dot rule, one level out.

          `backdrop-filter` also makes this a stacking context and a containing
          block for fixed/absolute descendants. Neither bites: the unpaid dot is
          positioned against its own `relative` icon wrapper, not against this.
        */}
        <div className="flex flex-1 rounded-card bg-bg/80 backdrop-blur-sm">
          {NAV_TABS.map(({ key, href, label }) => {
            const active = isActive(href, pathname);
            const Icon = ICON[key];
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
                  "flex flex-1 flex-col items-center justify-center gap-2 rounded-card py-2 transition-colors",
                  // Stated once per branch rather than as a base colour this
                  // overrides, so correctness never rests on tailwind-merge
                  // resolving two `text-{color}` classes last-wins — the trap
                  // `HeaderNav` and `Label.tsx` both document. The ink is on the
                  // link so the icon inherits it through `currentColor`.
                  //
                  // No `hover:` state: the design draws none, and this is
                  // `lg:hidden`. 123×56 clears the repo's 44px tap floor
                  // outright, so no `.tap-target` and none of the header
                  // account button's `after:`-pseudo arithmetic.
                  active ? "bg-fill-deep text-shell-ink" : "text-shell-mute",
                )}
              >
                {/*
                  Sized to the icon box on purpose: with no border and no
                  padding its padding box IS 20×20, so `-top-1 -right-1` (4px)
                  centres the 8px dot on the icon's top-right corner, which is
                  what the Figma measurement describes. This is NOT the header's
                  `-0.5` case — that element is a `border-box` 40px circle with a
                  1px border, so its padding box is 38px and the naive
                  arithmetic is off by one there. `block` is load-bearing:
                  preflight sets `svg { display: block }`, and a block child in
                  an inline box makes anonymous block boxes and breaks the 56px
                  stack.

                  No `border-2 border-bg` ring around the dot, unlike the
                  header's. That ring exists because the header bar is 12%
                  opaque and a standings row could pass behind the dot; this one
                  sits on an 85%-white track.
                */}
                <span className="relative block h-5 w-5">
                  <Icon className="h-5 w-5" />
                  {dot ? (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-badge-due"
                    />
                  ) : null}
                </span>
                {/*
                  12/600 at line-height 1, with letter-spacing left at `normal`
                  (0 for Inter) rather than spelled out in a class that does
                  nothing. Built-in `text-xs`, never the `label-md` token: its
                  tracking is 0.06em where the design says 0, AND tailwind-merge
                  files `text-label-md` as a text COLOUR and drops it the moment
                  a caller passes one.

                  The DOM text stays sentence case and the uppercasing is CSS,
                  which is what keeps the accessible name "Account" — the
                  substring the `aria-label` above depends on.
                */}
                <span className="whitespace-nowrap text-xs font-semibold uppercase leading-none">
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

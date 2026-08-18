"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { ACCOUNT_HREF, TABS, isActive } from "./nav";

/**
 * The interactive half of the app header: the centred tab pill and the account
 * button pinned to the right edge.
 *
 * It returns a *fragment of two elements*, not a wrapper, so both land as direct
 * children of `AppHeader`'s flex row. That is what makes the centring work: the
 * row gives the identity block and this component's right-hand wrapper `flex-1`
 * from a zero basis, so the pill — the only `shrink-0` child — sits on the
 * shell's true midpoint rather than halfway between its two neighbours, which
 * are different widths. The design achieves the same thing with
 * `left-1/2 -translate-x-1/2`; flex is used here because an absolutely
 * positioned pill would sit *on top of* the other two at phone widths instead of
 * pushing against them. (`LeagueSwitcher`, which this replaces, used the same
 * fragment shape for the same reason.)
 *
 * The pill is a fixed 218px (4 + 105 + 105 + 4) at every width now, so the whole
 * header's arithmetic reduces to one line — each rail is half of what's left:
 *
 *     rail = (viewport − 32px gutters − 218px pill − 16px gaps) / 2
 *
 * A 360px phone gives each side 47px, so the 50px mark overruns its rail by 3px
 * and paints into the row's 8px gap — measured 5px of clearance left, against the
 * 4px the design's own 358px mobile frame leaves. At 358 this reproduces that
 * frame to the pixel: mark at 16, pill at 70, account button at 302, all three
 * exactly where Figma puts them.
 *
 * Nothing scrolls sideways, because both rails grow from a zero basis and an
 * overrunning child therefore always paints *inward*, into the gap, never toward
 * the viewport edge. Measured clean down to 320px. What does break, below 350px,
 * is the mark touching and then overlapping the pill — 320 sits 28px into that,
 * and was already past the equivalent line before this change, when the "Account"
 * text chip overran the right rail instead. An unsupported width, not a
 * regression. The rail is also what sets `AppHeader`'s wordmark breakpoint; the
 * arithmetic is written out there.
 *
 * Client Component, and the only one in the header — `usePathname` is the whole
 * reason. It still reads no league data itself: `buyInUnpaid` arrives as a prop
 * from `AppHeader`, which is where the one query lives.
 */
export function HeaderNav({ buyInUnpaid = false }: { buyInUnpaid?: boolean }) {
  const pathname = usePathname();
  const onAccount = isActive(ACCOUNT_HREF, pathname);

  /*
    105 × 40 chips, per the design, in a 48px track — which clears this repo's
    44px `.tap-target` floor (globals.css:54). The 36px chips this replaces
    missed it, and the note flagging that is gone with them.

    The fixed width no longer needs the `sm:` escape hatch it used to carry, and
    the reason is counter-intuitive, because the chips got *wider*: the pill grew
    34px (184 → 218), and the account button handed back about as much by shedding
    its "Account" label for a 40px circle. The row's intrinsic width lands at
    16 + 50 + 8 + 218 + 8 + 40 + 16 = 356, which fits a 360px phone. The account
    button is what pays for full-width chips down there.

    `whitespace-nowrap` is the backstop rather than decoration: 105px leaves only
    ~7px of slack around "Standings" at 16/600, and a wrapped label would break
    the 40px chip height and with it the pill. A third tab, or a longer one, wants
    this width revisited rather than quietly absorbed.
  */
  const chip =
    "flex h-10 w-[105px] items-center justify-center whitespace-nowrap " +
    "rounded-control border px-3 text-base font-semibold leading-[1.2] " +
    "transition-colors";

  return (
    <>
      <nav
        aria-label="Primary"
        className="flex shrink-0 items-center rounded-xl bg-fill-soft p-1"
      >
        {TABS.map(({ href, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                chip,
                // The ink is stated once per branch rather than once in `chip`,
                // because the design uses two different blacks — #000 selected,
                // #1E1E1E resting. A base colour overridden here would make
                // correctness rest on tailwind-merge resolving two `text-{color}`
                // classes last-wins, which is the class of behaviour `Label.tsx`
                // has already been bitten by.
                active
                  ? "border-shell-line bg-white text-black"
                  : // The design gives the resting chip a #F3F3F3 border — the
                    // track's own colour, i.e. invisible. Transparent rather than
                    // `border-fill-soft` because the two are identical at rest and
                    // differ only on hover, which the design doesn't draw: a grey
                    // ring around a `bg-white/60` chip reads as an artefact.
                    "border-transparent text-shell-ink hover:bg-white/60",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-1 justify-end">
        <Link
          href={ACCOUNT_HREF}
          // `UserIcon` is `aria-hidden`, so without this the link has no
          // accessible name at all and a screen reader falls back to reading the
          // href. The name was unchanged from when this was a text chip — only
          // the rendering had moved from visible text to a label — until the dot
          // arrived: a purely visual badge says nothing to a screen reader, so the
          // one piece of information it carries is spelled into the name instead.
          aria-label={buyInUnpaid ? "Account — buy-in unpaid" : "Account"}
          aria-current={onAccount ? "page" : undefined}
          className={cn(
            // `grid place-items-center` is this repo's idiom for a glyph in a
            // round box (`LoginFlow`, `NoLeagueState`, `WeekSchedule`).
            "relative grid h-10 w-10 shrink-0 place-items-center rounded-full",
            "border border-shell-line text-shell-ink transition-colors",
            // 40px drawn, 44px tapped — the pseudo-element reaches this repo's
            // `.tap-target` floor without moving the circle, costing a DOM node,
            // or contributing to layout (the 2px it adds on the right sits inside
            // the 16px gutter). The floor's own utility can't be used here: it
            // sets min-width/min-height, which would grow the visible ring.
            //
            // 3px, not the 2px the arithmetic looks like it wants. An absolutely
            // positioned pseudo-element resolves its insets against its parent's
            // PADDING box, and this ring is `border-box` 40px with a 1px border,
            // so that box is 38px — `-inset-0.5` measured 42×42 in the browser,
            // sitting 1px proud on each side rather than 2. 38 + 3 + 3 = 44,
            // centred. Anything that changes the border width has to revisit it.
            "after:absolute after:-inset-[3px] after:content-['']",
            // Beyond the design, which only draws the resting state: without
            // this, the account page is the one screen the chrome never admits
            // you're on. The rule the header follows is that the current item is
            // the one that differs from its own background — a chip rests on a
            // grey track and goes white to say "here"; this rests on the page and
            // goes grey to say the same thing.
            onAccount ? "bg-fill-soft" : "bg-white hover:bg-[#F6F7F9]",
          )}
        >
          <UserIcon className="h-5 w-5" />
          {/*
            The unpaid dot: 12px, sitting 1px proud of the ring on both axes, so
            a corner of it overhangs. That overhang is the design, and it is why
            nothing in this subtree may take `overflow-hidden`.

            **2px, for the 1px the design asks for**, and for the same reason the
            tap ring above needs 3px to reach 44: an absolutely positioned child
            resolves its insets against its ancestor's PADDING box, which on this
            `border-box` 40px circle with a 1px border is 38px. `-top-px` measured
            the dot flush with the drawn edge — 0px proud, not 1 — so the offset
            is `-0.5` (2px). Measured in the browser, after the first version of
            this comment confidently asserted the opposite. Anything that changes
            the border width has to revisit this number too.

            `border-2 border-bg` is beyond the design, which draws the dot on
            white. This header is a near-transparent bar: at rest the ring is
            invisible, and scrolled it stops the dot dissolving into a standings
            row passing behind it.

            aria-hidden, because the state is already in the link's accessible
            name above and announcing it twice is noise.
          */}
          {buyInUnpaid ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bg bg-badge-due"
            />
          ) : null}
        </Link>
      </div>
    </>
  );
}

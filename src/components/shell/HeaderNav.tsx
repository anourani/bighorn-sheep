"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { cn } from "@/lib/cn";
import { NAV_TABS, isActive } from "./nav";

/**
 * The desktop navigation: a pill floating at the top of the shell, holding the
 * app's mark and its three destinations as equal buttons.
 *
 * Only ever drawn from `lg` up — `AppHeader` hides itself below that and
 * `BottomTabBar` carries the same three destinations at the foot of a phone. The
 * two are the same model now (`NAV_TABS`) and differ only in how they draw it:
 * text buttons in a row here, icons over uppercase labels there.
 *
 * **What this replaces, and why the old shape is gone.** This component used to
 * return a *fragment of two elements* — a centred tab pill and a separate round
 * account button — so both could be direct children of `AppHeader`'s flex row
 * and `flex-1` rails from a zero basis could put the pill on the shell's true
 * midpoint. All of that arithmetic (the 218px pill, the rail formula, the 356px
 * intrinsic row that fitted a 360px phone) existed to solve a problem the
 * redesign deletes: everything is inside one pill now, and `justify-center`
 * centres it. Account is a peer button rather than an icon in a circle, so the
 * `after:-inset-[3px]` tap ring and the dot's `-0.5` padding-box offset are gone
 * with the circle they were measured against.
 *
 * Client Component, and still the only one in the header — `usePathname` is the
 * whole reason. It reads no league data itself: `buyInUnpaid` arrives as a prop
 * from `AppHeader`, which is where the one query lives.
 */
export function HeaderNav({ buyInUnpaid = false }: { buyInUnpaid?: boolean }) {
  const pathname = usePathname();

  return (
    /* 8 + 58 + 4 = 70px, straight off the frame. The row centres the pill and
       carries no background of its own — see `AppHeader` for why the bar behind
       it is transparent now. */
    <div className="flex items-center justify-center px-4 pb-1 pt-2">
      <nav
        aria-label="Primary"
        /*
          The pill: 397 × 58 at the design's own widths, and every number in it
          is the frame's — `gap-1` (4), `px-4 py-2` (16/8), `rounded-card` (16).

          Solid white, and Figma's `backdrop-blur-[4px]` is deliberately NOT
          transcribed: a blur cannot show through an opaque fill, so shipping the
          class would be dead CSS. This is a card floating over the page rather
          than frosted glass, which is what the hairline border and the drop
          shadow are for — a different treatment from `BottomTabBar` and
          `PickStickyBar`, both of which ARE frosted (`bg-bg/80` + blur). If that
          ever wants unifying it is a two-class change, not a structural one.

          `shadow-*`, not Figma's `drop-shadow` filter. For an opaque rounded
          rectangle the two are indistinguishable, and a `filter` would make this
          element a containing block for fixed descendants and a stacking context
          for no benefit at all.

          `AppHeader` and `BottomTabBar` both carry `aria-label="Primary"`. Two
          identically named landmarks in one document would be a real problem —
          but both hides are `display: none`, which removes the element from the
          accessibility tree outright, so exactly one is ever exposed.
        */
        className={cn(
          "flex items-center gap-1 rounded-card border border-shell-line/50 bg-white",
          "px-4 py-2 shadow-[0_6px_6px_rgba(0,0,0,0.08)]",
        )}
      >
        {/*
          Still a link home, and still the same 150×150 photograph — a circle at
          40px now rather than a 50px rounded square, and with no wordmark beside
          it. The design's variant is "Logged in - Minimal" and draws none; the
          app's name survives here only as this link's accessible name.

          It goes to the same place the Picks button does. That duplication is
          not new — the mark and the Picks chip have always both pointed at
          `/app` — it is only more visible now that they are adjacent, and
          removing the link would remove an affordance this change is not for.

          A plain <img>, not next/image: the reason `AppHeader` gave still holds —
          next/image would put the most visible above-the-fold element on every
          authenticated screen behind the optimisation endpoint to save
          single-digit kilobytes on a 40px mark.

          `max-w-none` is prophylaxis rather than load-bearing here, unlike in the
          old header where this link was `flex-1` from a zero basis and preflight's
          `img { max-width: 100% }` really did render the mark 47×50. Nothing
          constrains it inside a shrink-wrapped pill. Kept because it costs
          nothing and the trap is one layout change away.

          `alt=""` because the link carries the accessible name; two names on one
          control gets it announced twice.
        */}
        <Link
          href="/app"
          aria-label={`${APP_NAME} — home`}
          className="shrink-0 rounded-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 max-w-none shrink-0 rounded-full bg-shell-line object-cover"
          />
        </Link>

        {NAV_TABS.map(({ key, href, label }) => {
          const active = isActive(href, pathname);
          const dot = key === "account" && buyInUnpaid;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              /*
                The dot is a purely visual badge, so its one fact is spelled into
                the accessible name — verbatim the string `BottomTabBar` uses, so
                the same thing reads the same way in both navs. WCAG 2.5.3 Label
                in Name holds because the visible "Account" is a substring of it;
                when paid there is no label at all and the name comes from the
                visible text.
              */
              aria-label={dot ? "Account — buy-in unpaid" : undefined}
              className={cn(
                // `min-w-[100px]`, never a fixed width: "Standings" measures 111
                // in the frame, so a fixed 100 would clip it and a fixed 111
                // would make its two neighbours wrong.
                "relative flex h-10 min-w-[100px] items-center justify-center whitespace-nowrap",
                "rounded-control px-4 text-base font-semibold leading-[1.2] transition-colors",
                // Three inks across three states, each stated as a complete
                // branch rather than a base this overrides — the design uses two
                // different blacks (#000 selected, #1E1E1E on hover) and a base
                // colour overridden here would make correctness rest on
                // tailwind-merge resolving two `text-{color}` classes last-wins,
                // which is the behaviour `Label.tsx` has already been bitten by.
                //
                // Note the hover is an INK shift with no fill, where the chips
                // this replaces went to `bg-white/60`.
                active ? "bg-fill-soft text-black" : "text-shell-mute hover:text-shell-ink",
              )}
            >
              {label}
              {/*
                2px in from the button's top-right, which is the frame's offset
                taken directly. This is NOT the old account circle's `-0.5`-for-1px
                case: that element was a `border-box` 40px circle with a 1px
                border, so an absolutely positioned child resolved against its
                38px padding box. This button has no border, so the naive
                arithmetic is the right one.

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
      </nav>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * Client Component, and the only one in the header — `usePathname` is the whole
 * reason. Nothing here reads league data.
 */
export function HeaderNav() {
  const pathname = usePathname();
  const onAccount = isActive(ACCOUNT_HREF, pathname);

  /*
    36px chips, per the design, against this repo's own 44px `.tap-target` floor
    (globals.css:52). Transcribed as given and flagged rather than silently
    normalised: growing the chip to 44 would eat the 4px of track that makes the
    pill read as a pill. The track itself is 44px tall, so a slightly high or low
    tap still lands inside the control — it just may not land on a chip.
  */
  const chip =
    "flex h-9 items-center justify-center rounded-control border px-2 text-sm font-semibold leading-[1.2] text-shell-ink transition-colors";

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
                // 88px is the design's width, but two fixed 88s plus the mark
                // and the account button overflow a 360px viewport — so the
                // fixed width starts at `sm` and phones get the chips' natural
                // width instead.
                "sm:w-[88px]",
                active
                  ? "border-shell-line bg-white"
                  : // The design gives the resting chip a #F3F3F3 border — the
                    // track's own colour, i.e. invisible. Kept as a transparent
                    // border rather than dropped so selecting a tab doesn't
                    // shift the text by the 2px the border would have added.
                    "border-transparent hover:bg-white/60",
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
          aria-current={onAccount ? "page" : undefined}
          className={cn(
            chip,
            "shrink-0 border-shell-line",
            // Beyond the design, which only draws the resting state: without
            // this, the account page is the one screen the chrome never admits
            // you're on. Same fill as the pill's track, so it reads as "current"
            // in the same language the tabs use.
            onAccount ? "bg-fill-soft" : "bg-white hover:bg-[#F6F7F9]",
          )}
        >
          Account
        </Link>
      </div>
    </>
  );
}

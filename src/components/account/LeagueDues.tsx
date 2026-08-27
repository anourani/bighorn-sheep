import { LocalTime } from "@/components/ui/LocalTime";
import { VENMO_HANDLE, VENMO_URL } from "@/lib/app";
import { cn } from "@/lib/cn";
import { H3 } from "@/lib/type-scale";
import { AccountSection, BODY, CARD } from "./surfaces";
import { buyInView } from "./league-dues";
import type { LeagueSummary } from "@/lib/league/load";

/**
 * The paid / unpaid badge.
 *
 * Local to this file rather than a `Pill` variant: `Pill`'s eleven variants are
 * the standings palette — soft fills on tinted washes — and this is a saturated
 * solid with white text and its own hairline. Bending `Pill` to reach it would
 * have changed how Standings, My Picks and the roster read, for one badge on one
 * page.
 */
function BuyInBadge({ paid, children }: { paid: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] border px-2 py-[5px]",
        "text-[12px] font-semibold uppercase leading-none text-white",
        paid ? "border-badge-paid-line bg-badge-paid" : "border-badge-due-line bg-badge-due",
      )}
    >
      {children}
    </span>
  );
}

/**
 * "League Dues" — what you owe and whether the commissioner has ticked you off.
 *
 * One card, full width in the account page's 656px column. It was the page's
 * right-hand column under the title "For the Common Good", and it carried a
 * second "Say Something Nice" card that has since moved to Additional Settings
 * as a row with a Feedback button — hence the rename of this file, the module
 * beside it and its test.
 *
 * The card turns over at `lg`, which is where the whole app changes shape: a
 * stack on a phone, and a row on a desktop with the figure on the left, the
 * payment state on the right and a full-height rule between them. That rule is
 * the one fragile part — it reaches full height off the flex default
 * `align-items: stretch`, so **nothing in the card's class list may become
 * `items-start`**, and its `lg:h-auto` is what releases the base `h-px`.
 *
 * No state and no handlers of its own: the paid flag is admin-controlled and
 * read-only to the member (migration 0007), the amount is admin-controlled
 * (0010), and the Venmo link is an ordinary anchor. This docblock used to claim
 * that made it a server component, which was never true in this position —
 * `AccountClient` is `"use client"` and imports it directly, so it crosses into
 * the client bundle with everything else that file names, and `LocalTime` below
 * is itself a client component. A statement about the component, not the bundle.
 */
export function LeagueDues({ league }: { league: LeagueSummary }) {
  const view = buyInView({
    buyInCents: league.group.buyInCents,
    siteFeeCents: league.group.siteFeeCents,
    buyInPaid: league.buyInPaid,
    buyInPaidAt: league.buyInPaidAt,
  });

  return (
    <AccountSection title="League Dues">
      <div
        className={cn(
          CARD,
          "flex flex-col gap-3 lg:flex-row lg:gap-5",
          // Unpaid wears a 5px red cap and squares off its top corners against
          // it; paid has no cap and is a plain card. Both are in the mock-ups,
          // and the cap is the only thing that distinguishes the two states at a
          // glance from across the page.
          !view.paid && "rounded-t-none border-t-[5px] border-badge-due-line",
        )}
      >
        <div className="flex flex-col gap-[5px] lg:w-[200px] lg:shrink-0">
          {/* Not the `Label` primitive: this one is 12px/1.0 uppercase like
              Label, but the design tracks it at 0 where Label is set wide, and
              the difference shows at this size directly above a 32px number. */}
          <p className="text-[12px] font-semibold uppercase leading-none text-shell-mute">
            League Buy In
          </p>
          <div className="flex flex-col justify-center">
            {/* H3 — 32px/1.2/−4%, composed rather than retyped. That constant
                exists so the one size the design library calls H3 lives in one
                place, and it carries no colour precisely so callers can paint
                it. It went 24px → 32px in the restack. */}
            <p className={cn(H3, "text-shell-ink tabular-nums")}>{view.total}</p>
            {view.breakdown ? (
              <p className="text-[14px] font-medium leading-[1.35] tracking-[-0.14px] text-shell-mute tabular-nums">
                {view.breakdown}
              </p>
            ) : null}
          </div>
        </div>

        <span aria-hidden className="h-px w-full bg-shell-line lg:h-auto lg:w-px" />

        <div className="flex min-w-0 flex-col gap-3 lg:flex-1 lg:gap-2">
          <div className="flex items-center gap-2">
            <BuyInBadge paid={view.paid}>{view.badge}</BuyInBadge>
            {/* Dropped entirely when the column is null rather than rendered as
                "Updated —". See `BuyInView.updatedIso`: a membership nobody has
                toggled since 0010 legitimately has no date. */}
            {view.updatedIso ? (
              <span className="text-[12px] font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute">
                Updated{" "}
                <LocalTime iso={view.updatedIso} mode="monthdayclock" />
              </span>
            ) : null}
          </div>

          {view.paid ? (
            <p className={cn(BODY, "font-semibold text-shell-ink")}>
              Your league dues were paid. Thank you.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className={cn(BODY, "font-medium text-shell-ink")}>
                Please venmo{" "}
                <a
                  href={VENMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link underline decoration-solid [text-underline-position:from-font]"
                >
                  {VENMO_HANDLE}
                </a>{" "}
                {view.total} to officially join the league.
              </p>
              {/* The deadline is the league's own entry cut-off, not a second
                  date somebody has to remember to keep in sync: it is already
                  the moment `join_by_invite` starts refusing codes, so "removed
                  from the league" and "entry closed" are the same boundary. */}
              <p className={cn(BODY, "font-normal text-shell-mute")}>
                Anyone who doesn&apos;t pay by{" "}
                <LocalTime iso={league.group.entryClosesAt} mode="weekdaydate" /> will be
                removed from the league.
              </p>
            </div>
          )}
        </div>
      </div>
    </AccountSection>
  );
}

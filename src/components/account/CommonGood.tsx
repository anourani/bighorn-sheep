import { LocalTime } from "@/components/ui/LocalTime";
import { FEEDBACK_URL, VENMO_HANDLE, VENMO_URL } from "@/lib/app";
import { cn } from "@/lib/cn";
import { AccountSection, BODY, CARD } from "./surfaces";
import { buyInView } from "./common-good";
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
 * "For the Common Good" — the right column of the account page: what you owe,
 * whether the commissioner has ticked you off, and a way to complain about it.
 *
 * A server component. Nothing here is interactive — the paid flag is
 * admin-controlled and read-only to the member (migration 0007), the amount is
 * admin-controlled (0010), and both links are ordinary anchors — so none of it
 * needs to ship as client JS.
 */
export function CommonGood({ league }: { league: LeagueSummary }) {
  const view = buyInView({
    buyInCents: league.group.buyInCents,
    siteFeeCents: league.group.siteFeeCents,
    buyInPaid: league.buyInPaid,
    buyInPaidAt: league.buyInPaidAt,
  });

  return (
    <AccountSection title="For the Common Good" className="lg:h-full">
      {/* The inner wrapper is the design's, and it earns its place on desktop:
          it is what lets the feedback card below take the slack so this column
          ends level with Personal Details beside it. */}
      <div className="flex flex-col gap-3 lg:h-full lg:flex-1">
        <div
          className={cn(
            CARD,
            "flex flex-col gap-3",
            // Unpaid wears a 5px red cap and squares off its top corners against
            // it; paid has no cap and is a plain 4px card. Both are in the
            // mock-ups, and the cap is the only thing that distinguishes the two
            // states at a glance from across the page.
            !view.paid && "rounded-t-none border-t-[5px] border-badge-due-line",
          )}
        >
          <div className="flex flex-col gap-[5px]">
            {/* Not the `Label` primitive: this one is 12px/1.0 uppercase like
                Label, but the design tracks it at 0 where Label is set wide, and
                the difference shows at this size directly above a 24px number. */}
            <p className="text-[12px] font-semibold uppercase leading-none text-shell-mute">
              League Buy In
            </p>
            <div className="flex flex-col justify-center">
              <p className="text-[24px] font-semibold leading-[1.2] text-shell-ink tabular-nums">
                {view.total}
              </p>
              {view.breakdown ? (
                <p className="text-[14px] font-medium leading-[1.35] tracking-[-0.14px] text-shell-mute tabular-nums">
                  {view.breakdown}
                </p>
              ) : null}
            </div>
          </div>

          <span aria-hidden className="h-px w-full bg-shell-line" />

          <div className="flex items-center gap-2">
            <BuyInBadge paid={view.paid}>{view.badge}</BuyInBadge>
            {/* Dropped entirely when the column is null rather than rendered as
                "Updated —". See `BuyInView.updatedIso`: a membership nobody has
                toggled since 0010 legitimately has no date. */}
            {view.updatedIso ? (
              <span className="text-[12px] font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute">
                Updated{" "}
                <LocalTime iso={view.updatedIso} mode="monthday" />
              </span>
            ) : null}
          </div>

          {view.paid ? (
            <p className={cn(BODY, "font-normal text-shell-mute")}>
              You paid your dues. Thank you.
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

        <div className={cn(CARD, "flex flex-col justify-end gap-1.5 lg:flex-1")}>
          <p className="text-[12px] font-semibold uppercase leading-none text-shell-mute">
            Say Something Nice
          </p>
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-max text-[18px] font-medium leading-[1.2] text-link underline decoration-solid [text-underline-position:from-font]"
          >
            Leave Feedback
          </a>
        </div>
      </div>
    </AccountSection>
  );
}

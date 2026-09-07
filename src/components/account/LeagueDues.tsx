import { Fragment } from "react";
import { LocalTime } from "@/components/ui/LocalTime";
import { Label } from "@/components/ui/Label";
import { AddEntryCta } from "@/components/app/AddEntryCta";
import { joinClosesAt } from "@/lib/game/season";
import { VENMO_HANDLE, VENMO_URL } from "@/lib/app";
import { cn } from "@/lib/cn";
import { AccountSection, BODY, CARD, VALUE } from "./surfaces";
import { buyInView, duesState } from "./league-dues";
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


/** One field in an entry's row — its label over its value. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 lg:min-w-px lg:flex-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** A 1px rule between rows, and between the last row and the footer. */
function Divider() {
  return <span aria-hidden className="h-px w-full shrink-0 bg-shell-line" />;
}

/**
 * "League Dues" — what each of your entries costs and whether the commissioner
 * has ticked it off.
 *
 * Figma `3934:62955` lays out all ten variants: three states (Paid, Unpaid,
 * **Partial**) x two viewports x one or two entries — Partial having no
 * one-entry form, since a single entry cannot be half-settled.
 *
 * ONE CARD, ONE ROW PER ENTRY, and that is the shape change. This was one card
 * per entry for about an hour (the first pass at 0017, before this design
 * existed), which stacked two headed cards and repeated the deadline, the
 * how-to-pay and the thank-you inside each. The design puts the entries in a
 * single card as rows and states the shared things once — which is right,
 * because the deadline and the payment instructions are facts about the LEAGUE,
 * not about an entry.
 *
 * The footer is therefore the module's whole per-state behaviour: `paid` gets
 * the thank-you, and `unpaid` and `partial` both get How to Pay, because a
 * player with one entry settled still owes for the other and still needs the
 * handle.
 *
 * **The "Add 2nd Entry" button belongs here**, below the card, on the one-entry
 * variants. It sat on the picks page and in Additional Settings while this
 * design was outstanding — both invented placements, and both now removed. This
 * is where a player is already thinking about what an entry costs, which is the
 * fact the confirmation dialog leads with.
 */
export function LeagueDues({
  leagues,
  viewerName,
  canAddEntry,
}: {
  /**
   * Every summary for the active league — one per ENTRY, so this is one element
   * for almost everybody and two for a player who has taken a second.
   */
  leagues: LeagueSummary[];
  /** The viewer's own "First L.", which is what the design's ENTRY NAME shows. */
  viewerName: string;
  /** Exactly one entry, and the league's entry window still open. */
  canAddEntry: boolean;
}) {
  const first = leagues[0];
  if (!first) return null;
  const state = duesState(leagues);

  return (
    <AccountSection
      title="League Dues"
      description={
        <>
          Any entry still unpaid through{" "}
          <LocalTime iso={joinClosesAt(first.group)} mode="weekdaydate" /> will be removed
          from the league.
        </>
      }
    >
      {/* The deadline is the league's own JOIN cut-off, not a second date to
          keep in sync: it is already the moment `join_by_invite` starts refusing
          codes AND the moment `remove_member` stops accepting, so "removed from
          the league" and "joining closed" are the same boundary — which is why
          removal moved to the last Week 1 kickoff in 0018 along with joining,
          rather than being left behind on `entryClosesAt`. It is stated once, above the card, for every state — the
          design keeps it on the Paid variants too, where it is a reassurance
          rather than a warning. */}
      <div className={cn(CARD, "flex flex-col gap-4")}>
        {leagues.map((league, i) => {
          const view = buyInView({
            buyInCents: league.group.buyInCents,
            siteFeeCents: league.group.siteFeeCents,
            buyInPaid: league.buyInPaid,
            buyInPaidAt: league.buyInPaidAt,
          });
          return (
            // Keyed on the membership id — the one id that differs between two
            // entries of the same league.
            <Fragment key={league.memberId}>
              {i > 0 ? <Divider /> : null}
              {/* Stacked on a phone, three columns from `lg`. The account
                  column turns over at `lg` like the rest of the app — see
                  Personal Details' two-across grid directly above it. */}
              <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
                <Field label="Entry Name">
                  <div className="flex items-center gap-[5px]">
                    <p className={cn(VALUE, "truncate")}>{viewerName}</p>
                    {/* The same badge the standings board and the admin roster
                        draw, on the same rule: second entries only. Here it is
                        the only thing distinguishing two rows that otherwise
                        carry an identical name, so it is not decorative — hence
                        the sr-only text beside the aria-hidden digit, rather
                        than an aria-label that would fail WCAG 2.5.3's
                        substring rule against the visible "2". */}
                    {league.entryNo === 2 ? (
                      <>
                        <span
                          aria-hidden
                          className="shrink-0 rounded-sm border border-shell-line bg-fill-soft px-1.5 py-1 text-[12px] font-semibold uppercase leading-none text-ink-mute"
                        >
                          2
                        </span>
                        <span className="sr-only">Entry 2</span>
                      </>
                    ) : null}
                  </div>
                </Field>

                <Field label="League Buy In">
                  <div className="flex flex-col">
                    {/*
                      The TOTAL, where the design's mock reads "$20" against a
                      label that says League Buy In.

                      The two agree whenever the site fee is zero, which is the
                      row the design draws. Where a fee exists they do not, and
                      this module's job is to tell you what you owe — a player
                      who reads "$20", sends $20 and is short by the fee has been
                      misled by the screen. So the total is the number, and the
                      breakdown underneath says where it came from rather than
                      leaving the label looking wrong.
                    */}
                    <p className={VALUE}>{view.total}</p>
                    {view.breakdown ? (
                      <p className="text-[12px] font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute tabular-nums">
                        {view.breakdown}
                      </p>
                    ) : null}
                  </div>
                </Field>

                <Field label="Status">
                  {/* `flex-wrap` plus a non-breaking stamp, which the design's
                      170px inline row does not need and this one does — see the
                      clock note below. Inline while it fits (a null stamp, a
                      wider column), and the whole stamp drops to its own line
                      when it does not, rather than breaking between "10/21," and
                      "6:47 PM" and leaving two rows different heights. */}
                  <div className="flex flex-wrap items-center gap-1">
                    <BuyInBadge paid={view.paid}>{view.badge}</BuyInBadge>
                    {/* Dropped entirely when the column is null rather than
                        rendered as "Updated —": a membership nobody has toggled
                        since 0010 legitimately has no date.

                        WITH THE CLOCK, where the design's mock reads "Updated
                        10/21". That is not a transcription slip to fix: the
                        clock was added deliberately because an admin toggling
                        paid off and on the same afternoon watched a date that
                        never moved, and a stamp that cannot show a same-day
                        change is not a stamp. `formatMonthDay` was deleted for
                        it. The design's shorter string would reintroduce the
                        bug exactly. */}
                    {view.updatedIso ? (
                      <span className="whitespace-nowrap text-[12px] font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute">
                        Updated <LocalTime iso={view.updatedIso} mode="monthdayclock" />
                      </span>
                    ) : null}
                  </div>
                </Field>
              </div>
            </Fragment>
          );
        })}

        <Divider />

        {state === "paid" ? (
          <p className={cn(BODY, "font-semibold text-shell-ink")}>
            {/* An emoji, as drawn, and aria-hidden: read aloud, "white heavy
                check mark your league dues were paid" is not the sentence. */}
            <span aria-hidden>✅</span> Your league dues were paid. Thank you.
          </p>
        ) : (
          <div className="flex w-full flex-col gap-[5px]">
            <Label>How to Pay</Label>
            <p className="text-[14px] font-medium leading-[1.35] tracking-[-0.14px] text-shell-ink">
              Venmo{" "}
              <a
                href={VENMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline decoration-solid [text-underline-position:from-font]"
              >
                {VENMO_HANDLE}
              </a>{" "}
              (league commissioner) the league buy in to officially join the league.
            </p>
          </div>
        )}
      </div>

      {/* Outside the card, per the design — it is an action on your membership,
          not a line item in the bill. Hidden at two entries and once entry
          closes, matching what `add_entry` will actually accept. */}
      {canAddEntry ? (
        <AddEntryCta
          groupId={first.group.id}
          buyInCents={first.group.buyInCents}
          siteFeeCents={first.group.siteFeeCents}
        />
      ) : null}
    </AccountSection>
  );
}

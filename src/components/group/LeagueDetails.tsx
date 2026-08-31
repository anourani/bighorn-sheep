"use client";

import { useState } from "react";
import { Label } from "@/components/ui/Label";
import { isEntryOpen } from "@/lib/game/season";
import { formatMoney } from "@/lib/money";
import { H4 } from "@/lib/type-scale";
import { cn } from "@/lib/cn";
import type { Group } from "@/lib/league/types";

/**
 * One label/value pair on its own rule. Figma row `4181:154852`.
 *
 * `min-h-[34px]` rather than the frame's fixed `h`, so a value that outgrows the
 * row — a long money figure, the invite code revealed on a clipboard failure —
 * pushes the rule down instead of being clipped by it. Both halves are `flex-1`
 * with `min-w-0`: the frame splits the 235px column evenly at 113.5 each, and
 * without `min-w-0` a `whitespace-nowrap` value would refuse to shrink and blow
 * the column out.
 *
 * The 6/2 padding split is the frame's, not a centring shortcut — it sits the
 * pair 1.5px below the row's midpoint, which is what the mock-up draws.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center gap-2 border-b border-shell-line pb-0.5 pt-1.5">
      <Label className="flex-1 min-w-0">{label}</Label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    // `em` for the tracking, as everywhere: Figma reports letter-spacing as
    // percent times 100, so this step's -1 is -1% and survives a size change.
    <span className="text-base font-semibold leading-[1.35] tracking-[-0.01em] text-shell-ink">
      {children}
    </span>
  );
}

/** A row value that acts rather than states. Both of them open or copy. */
function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-left text-base font-medium leading-[1.2] text-link underline underline-offset-2"
    >
      {children}
    </button>
  );
}

/**
 * The standings page's league header: the name set large beside the league's
 * money, headcount and its two actions. Figma `4181:154890` — one 1000px row on
 * a desktop (a `flex-1` name block and two 235px columns), one stacked column
 * below `lg`.
 *
 * It replaced four grey tiles carrying League / Current week / Survivors /
 * Rules. The week and the survivor count are not missing — they moved into the
 * `Headcount` card directly below, which is what that card is now for, and
 * repeating them here would put the same two numbers on the screen twice.
 *
 * **DOM order is the mobile order, and the desktop layout falls out of it.**
 * The two columns are rendered once and stack full-width below `lg`, which is
 * exactly the mobile frame's sequence — so nothing is rendered twice and no
 * branch can drift between the widths.
 *
 * `phase` and `currentWeek` are gone from the props rather than left unused: the
 * two fields that read them went to the card. What arrived instead is `appUrl`
 * and `now`, which the invite row needs.
 *
 * There is no section heading and no admin gear. The league's own name is the
 * page's `<h1>` — the page had none until now, so its two `<h2>`s hung off
 * nothing — and the way into `AdminSettingsDrawer` is the Admin Control Center
 * row on /app/account.
 */
export function LeagueDetails({
  group,
  memberCount,
  appUrl,
  now,
  onOpenRules,
}: {
  group: Group;
  /** `members.length`, NOT `survivorCounts().total` — that one is deliberately
   *  `alive + eliminated` and drops a row with an unrecognised status, which is
   *  right for a survivor tally and wrong for a headcount. */
  memberCount: number;
  appUrl: string;
  now: Date;
  onOpenRules: () => void;
}) {
  // The invite code is not on screen, so a blocked clipboard would leave a
  // member with no way to get the link at all. This reveals the code on that
  // failure and only on it — the same trade `InviteCta` makes further down the
  // page, and the reason `Row` grows rather than clips.
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    // `appUrl` is inlined at build time and is deliberately blank outside
    // production, so `||` and never `??`: an empty string would pass straight
    // through and build a relative `/login?invite=…` that nobody can paste.
    // Resolved in the handler rather than in render, because this component
    // does render on the server and `window` is not there.
    const origin = appUrl || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/login?invite=${group.inviteCode}`);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }

  // Matches `InviteCta` below: the code still exists after the first Week 1
  // kickoff but `join_by_invite` refuses it, so offering it is a dead end.
  const canInvite = isEntryOpen(new Date(group.entryClosesAt), now);

  return (
    <section className="flex flex-col items-start lg:flex-row lg:gap-5">
      {/* `flex flex-col`, not a plain block, and the gap rather than a margin on
          the heading. `Label` renders a `<span>`: inline, its line box takes the
          PARENT's strut — 24px off the page's 16/1.5 body type — rather than its
          own `leading-none` 12, and the module came out 12px tall than the frame
          at both widths. As flex items both children are blockified and measure
          themselves. Same reason the tiles this replaced were a flex column. */}
      <div className="flex w-full flex-col gap-1.5 pb-3 pr-2 pt-2 lg:min-w-0 lg:flex-1">
        <Label>League</Label>
        {/* `H4` composed with one override rather than a second constant: the
            design library's H4 and H3 differ by nothing but the size, so the
            desktop step is a single class. Both are `-0.04em`, so the tracking
            follows the size for free — which a `-0.96px` would not. */}
        <h1 className={cn(H4, "text-shell-ink lg:text-[32px]")}>{group.name}</h1>
      </div>

      <div className="w-full lg:w-[235px] lg:shrink-0">
        <Row label="Buy in">
          <Value>{formatMoney(group.buyInCents)}</Value>
        </Row>
        <Row label="Headcount">
          <Value>{memberCount}</Value>
        </Row>
        {/* The pot, not the gross. `siteFeeCents` is the site's cut and is
            charged on top of the buy-in — the account page's League Dues card
            shows a member the two added together — so what the winner takes is
            the buy-in alone, times everyone in. Derived live; nothing stores it. */}
        <Row label="Winner takes">
          <Value>{formatMoney(group.buyInCents * memberCount)}</Value>
        </Row>
      </div>

      <div className="w-full lg:w-[235px] lg:shrink-0">
        <Row label="Rules">
          {/* A button, not an anchor: it opens a dialog, it doesn't navigate. */}
          <LinkButton onClick={onOpenRules}>League Rules</LinkButton>
        </Row>
        {canInvite ? (
          <Row label="Invite link">
            {failed ? (
              // No `aria-label` on the button above it, deliberately: one would
              // override the children, so this swap — the whole confirmation —
              // would never be announced.
              <span className="select-all break-all font-mono text-sm text-shell-ink">
                {group.inviteCode}
              </span>
            ) : (
              <LinkButton onClick={copy}>{copied ? "Copied" : "Copy Link"}</LinkButton>
            )}
          </Row>
        ) : null}
      </div>
    </section>
  );
}

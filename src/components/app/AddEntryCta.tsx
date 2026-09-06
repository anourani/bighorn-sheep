"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { addEntry } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

/**
 * Stable codes from `addEntry`, mapped to copy. Same shape as `PICK_ERROR` and
 * `MoreSection`'s ladders: the action returns a code, never database text.
 *
 * `migration_missing` is the one worth its own sentence rather than a catch-all.
 * `add_entry` does not exist until 0017 is applied BY HAND, and this button is
 * the first thing anyone will click to find that out — so it should not say
 * "try again", which is an invitation to click forever. (`rpcErrorCode` is what
 * turns PostgREST's PGRST202 into this code.)
 */
const ERROR_COPY: Record<string, string> = {
  entry_limit: "You already have two entries — that's the limit.",
  entry_closed: "Entry for this league has closed, so a second one can't be added.",
  not_a_member: "You're not in this league.",
  migration_missing: "Second entries aren't switched on for this league yet.",
  not_authenticated: "Your session expired — sign in again.",
  add_entry_failed: "We couldn't add that entry. Try again in a moment.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

/**
 * "Add a second entry" — the button and its confirmation.
 *
 * PLACEMENT IS THE LEAGUE DUES MODULE'S, and this component is only the
 * control. Figma `3934:62955` puts an "Add 2nd Entry" button below the dues card
 * on both one-entry variants, which is why this renders a bare button rather
 * than the labelled row it began as: it had two invented placements (the picks
 * page, and a row in Additional Settings) while that design was outstanding, and
 * both are gone now that there is a designed home for it.
 *
 * The button is the design's `size=Small, style=Secondary` — 36px, `min-w-100`,
 * 8px radius, white on a hairline — which is `Button variant="outline"
 * size="sm"` with the minimum width added.
 *
 * It stays in `components/app/` rather than moving into `account/`: it owns a
 * server action and a confirmation dialog, and `account/` is documented as the
 * account PAGE's vocabulary. One caller today is not an argument for burying it
 * in the file that calls it.
 *
 * THE CONFIRMATION IS NOT CEREMONY. A second entry is a second buy-in — real
 * money owed to whoever runs the league — and, unlike almost everything else in
 * this app, it cannot be undone from the UI: `remove_member` takes an entry
 * number now, but nothing renders a control for it. The dialog says both things.
 */
export function AddEntryCta({
  groupId,
  buyInCents,
  siteFeeCents,
  className,
}: {
  groupId: string;
  /**
   * The league's buy-in, so the dialog can name what a second entry costs.
   * Optional because the amount is a nicety in the copy, not the point of it —
   * a league that has not set a price still gets the "settle up" sentence.
   */
  buyInCents?: number;
  siteFeeCents?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await addEntry({ groupId });
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? ERROR_COPY.add_entry_failed!);
          return;
        }
        // The action revalidates /app, /app/standings and /app/account, so the
        // switcher, the new board row and the new dues line all arrive on the
        // next paint. Nothing to navigate to.
        setOpen(false);
      } catch (err) {
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError(ERROR_COPY.add_entry_failed!);
      }
    });
  }

  const owed = (buyInCents ?? 0) + (siteFeeCents ?? 0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("min-w-[100px] self-start", className)}
        onClick={() => setOpen(true)}
      >
        Add 2nd Entry
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Second entry"
        title="Add a second entry?"
        description="You'll play two independent runs at the season."
        footer={
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button block disabled={pending} onClick={confirm}>
              {pending ? "Adding…" : "Yes, add it"}
            </Button>
            <Button variant="outline" block disabled={pending} onClick={() => setOpen(false)}>
              Never mind
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm leading-relaxed text-ink-soft">
          <p>
            Your second entry keeps its own picks, its own strikes and its own place on
            the standings board. Losing with one doesn&apos;t end the other, and you can
            pick the same team with both in the same week.
          </p>
          <p>
            <b className="font-semibold text-ink">It costs another buy-in.</b>{" "}
            {owed > 0
              ? `That's ${formatMoney(owed)} more owed to your league.`
              : "Settle up with whoever runs your league."}
          </p>
          <p>
            {/* Said here rather than discovered later: this is the one thing on
                the screen that a player cannot walk back themselves. */}
            There&apos;s no way to remove an entry from the app yet — ask your league
            admin if you change your mind.
          </p>
          {error ? <p className="font-medium text-out">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}

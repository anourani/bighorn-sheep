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
 * NO MOCKUP EXISTS for this. The Figma set covers the switcher and the
 * standings badge but not how a second entry is created, so the placement here
 * is a decision rather than a transcription: a plain row where the switcher will
 * appear once it is taken, and the same row again in the account page's
 * Additional Settings. Both are where someone already goes to think about their
 * entries. Revisit when the design catches up.
 *
 * In `components/app/` because it renders on two unrelated screens — the same
 * reason `NoLeagueState` lives there. `picks/` and `account/` are each one
 * screen's vocabulary, and importing across them is how a component quietly
 * becomes shared without anyone saying so.
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
  /** The league's buy-in, so the dialog can name what a second entry costs. */
  buyInCents: number;
  siteFeeCents: number;
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

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-control bg-fill-soft p-4",
          className,
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-shell-ink">Play a second entry</p>
          <p className="text-xs text-shell-mute">
            A separate set of picks, with its own dues.
          </p>
        </div>
        <Button variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          Add Entry
        </Button>
      </div>

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
            {buyInCents > 0
              ? `That's ${formatMoney(buyInCents + siteFeeCents)} more owed to your league.`
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

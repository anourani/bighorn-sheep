"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { InfoIcon } from "@/components/icons";
import { closeOwnAccount } from "@/app/app/actions";
import { createClient } from "@/lib/supabase/client";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";

const ERROR_COPY: Record<string, string> = {
  // 0010 not applied to this database is the likeliest cause, and it is worth
  // saying "try again" rather than something specific: the player can't fix it,
  // and the detail is in the Netlify function log for whoever can.
  close_failed: "We couldn't close your account. Try again in a moment.",
  not_authenticated: "Your session expired — sign in again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

/**
 * The "are you sure?" behind Danger Zone's Delete Account.
 *
 * The copy does the real work here. "Delete" is what the design's link says and
 * what a player expects to click, but it is not what happens: closing an account
 * writes one row and erases nothing, because the player's name, picks and
 * strikes are part of the league's record for the season. Saying so plainly on
 * this screen is the difference between a promise the app keeps and one it
 * quietly breaks — in either direction, since someone who wants to be *erased*
 * needs to know this isn't that.
 *
 * Two-step by construction: the action writes the closure, then the client signs
 * out. Order matters — `signOut()` invalidates the session the action needs, so
 * doing it first would close nothing and log a `not_authenticated`.
 */
export function DeleteAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await closeOwnAccount();
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? "We couldn't close your account. Try again.");
          return;
        }
        try {
          await createClient().auth.signOut();
        } catch {
          // Supabase not configured, or the sign-out call failed. The closure is
          // already written, and /app's layout will bounce them regardless — so
          // land them on the sign-in screen either way rather than leaving them
          // on a page that now lies about their account.
        }
        window.location.href = "/login";
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("We couldn't close your account. Try again.");
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Danger zone"
      title="Close your account?"
      description="This signs you out for good and locks you out of the app."
      footer={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="danger" block disabled={pending} onClick={confirm}>
            {pending ? "Closing…" : "Yes, close my account"}
          </Button>
          <Button variant="outline" block disabled={pending} onClick={onClose}>
            Never mind
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm leading-relaxed text-ink-soft">
        <p>
          <b className="font-semibold text-ink">Nothing is deleted.</b> Your name, your
          picks and your strikes stay on the standings board — they are part of the
          season&apos;s record, and pulling them out would change everyone else&apos;s.
        </p>
        <p>
          What changes is your access: you&apos;ll be signed out, and signing back in
          won&apos;t let you in. Only your commissioner can reopen your account, or remove
          you from the board for good.
        </p>
        {error ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

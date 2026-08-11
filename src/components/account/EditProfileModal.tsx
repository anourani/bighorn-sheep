"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { InfoIcon } from "@/components/icons";
import { updateProfile } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import type { Viewer } from "@/lib/league/load";

const ERROR_COPY: Record<string, string> = {
  first_name_required: "Enter your first name.",
  phone_invalid: "That number is too long.",
  not_authenticated: "Your session expired — sign in again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

const INPUT_CLASS =
  "w-full rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong";

/**
 * Name and phone in one sheet, opened from either the NAME or NUMBER tile.
 *
 * A sheet rather than editing in place: the account page lays those tiles out in
 * an auto-fill grid that collapses to one column on a phone, and swapping a tile
 * for an input reflows the whole row underneath the thumb that just tapped it.
 */
export function EditProfileModal({
  open,
  onClose,
  viewer,
  currentPhone,
}: {
  open: boolean;
  onClose: () => void;
  viewer: Viewer;
  /** Separate from Viewer: the phone is private data loaded only for the account page. */
  currentPhone: string | null;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(viewer.firstName);
  const [lastName, setLastName] = useState(viewer.lastName);
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed on open so a cancelled edit doesn't persist as stale draft text, and
  // so a change made in another tab is picked up after router.refresh().
  useEffect(() => {
    if (!open) return;
    setFirstName(viewer.firstName);
    setLastName(viewer.lastName);
    setPhone(currentPhone ?? "");
    setError(null);
  }, [open, viewer.firstName, viewer.lastName, currentPhone]);

  function submit() {
    if (firstName.trim().length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateProfile({ firstName, lastName, phone });
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? "Couldn't save your details. Try again.");
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("Couldn't save your details. Try again.");
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Account"
      title="Your details"
      description="Your name is how the rest of the league sees you."
      footer={
        <Button variant="primary" block disabled={firstName.trim().length === 0 || pending} onClick={submit}>
          {pending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="profile-first-name" className="mb-1.5 block">
            <Label className="text-ink-mute">First name</Label>
          </label>
          <input
            id="profile-first-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            placeholder="Alex"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="profile-last-name" className="mb-1.5 block">
            <Label className="text-ink-mute">Last name</Label>
          </label>
          <input
            id="profile-last-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            placeholder="Nourani"
            className={INPUT_CLASS}
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-mute">
            Shown as &ldquo;First L.&rdquo; everywhere in the app.
          </p>
        </div>

        <div>
          <label htmlFor="profile-phone" className="mb-1.5 block">
            <Label className="text-ink-mute">Number (optional)</Label>
          </label>
          <input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="555-914-2200"
            className={INPUT_CLASS}
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-mute">
            Only you and your league admins can see this. Leave it blank to remove it.
          </p>
        </div>

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

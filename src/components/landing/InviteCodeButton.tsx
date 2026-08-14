"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { InviteEntry } from "@/components/landing/InviteEntry";

/**
 * The header's "Enter Invite Code" action. A modal rather than an inline box:
 * the design gives the hero to the league's status, and a code field is only
 * useful to the fraction of visitors who already have one.
 *
 * No success state — `InviteEntry` validates against the anon `invite_preview`
 * RPC and then routes to /login?invite=CODE, so the modal navigates away rather
 * than resolving in place.
 *
 * `className` is passed in rather than imported from LandingHeader so the two
 * modules don't form a cycle; a string crosses the RSC boundary for free.
 */
export function InviteCodeButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Enter Invite Code
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Enter your invite code"
        description="Your league admin sent you a code. Enter it to join."
      >
        <InviteEntry />
      </Modal>
    </>
  );
}

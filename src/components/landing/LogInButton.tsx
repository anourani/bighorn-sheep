"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { LoginFlow } from "@/components/auth/LoginFlow";

/**
 * The header's "Log In" action. A modal rather than a link to /login: that page
 * carries its own hero — an eyebrow over a second "Last Man Standing" — directly
 * under the landing page's own, so following the link read as arriving at a
 * different, shrunken version of the same product.
 *
 * /login is still a real route, and still renders this same `LoginFlow`. Invite
 * links pasted into group chats are `…/login?invite=CODE`, and the auth callback
 * bounces failures to `…/login?error=`. Both arrive cold, with no page behind
 * them to overlay, so they keep the hero.
 *
 * No `eyebrow` and no `description` on the Modal: the landing page's own
 * branding is visible right behind the backdrop, and repeating it here would
 * reintroduce the duplication this exists to remove.
 *
 * State resets for free — `Modal` returns null before rendering children, so
 * `LoginFlow` unmounts on close and a half-typed email doesn't survive to the
 * next open.
 *
 * `className` is passed in rather than imported from LandingHeader so the two
 * modules don't form a cycle; a string crosses the RSC boundary for free.
 */
export function LogInButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Log In
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Log In">
        <LoginFlow variant="modal" />
      </Modal>
    </>
  );
}

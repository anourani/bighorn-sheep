"use client";

import { Button, type ButtonProps } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

/**
 * Log out, from anywhere.
 *
 * Extracted from `AccountClient` because `/account-closed` needs the identical
 * behaviour and is the one page where getting it wrong strands someone: they are
 * still signed in when they land there, and this button is the only control on
 * the screen.
 *
 * `window.location.href` rather than `router.push`, deliberately. Signing out
 * invalidates the session the React cache was built against, and a client-side
 * navigation would carry that stale tree onto the next screen; a full document
 * load throws it away.
 *
 * It lands on `/`, not `/login`. Logging out is not the start of logging back
 * in, and the landing page is the honest destination for someone who has just
 * left: it is the public face of the league, and it still carries a Log In
 * button for anyone who changes their mind. It matters more on
 * `/account-closed`, the other caller — a closed account sent to `/login` can
 * sign in again only to be bounced straight back to the same lockout screen.
 *
 * No conflict with the middleware's "signed-in visitors don't see `/`" rule:
 * the session is gone by the time the browser gets there. If `signOut()` failed
 * they land back in the app, which is what `/login` did in that case too.
 */
export function SignOutButton({
  className,
  variant = "primary",
  size,
  children = "Log out",
}: {
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  children?: React.ReactNode;
}) {
  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Supabase not configured — leave for the landing page regardless.
    }
    window.location.href = "/";
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={handleLogout}>
      {children}
    </Button>
  );
}

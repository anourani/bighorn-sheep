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
      // Supabase not configured — just return to the sign-in screen.
    }
    window.location.href = "/login";
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={handleLogout}>
      {children}
    </Button>
  );
}

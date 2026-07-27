import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing. Supabase redirects here with a `code` after the user taps
 * the email link. We exchange it for a session (cookies are writable in a Route
 * Handler, unlike a Server Component), then — if the link carried an invite —
 * join the league via the SECURITY DEFINER RPC before dropping the user into the
 * app. Any failure routes back to /login with a reason the page can explain.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const invite = searchParams.get("invite");

  // Only ever redirect to an internal /app path (open-redirect guard).
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/app") ? nextParam : "/app";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  if (invite) {
    const { error: joinError } = await supabase.rpc("join_by_invite", { p_code: invite });
    if (joinError) {
      const reason = joinError.message.includes("entry_closed")
        ? "entry_closed"
        : joinError.message.includes("invalid_code")
          ? "invalid_code"
          : "join_failed";
      return NextResponse.redirect(`${origin}/login?error=${reason}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

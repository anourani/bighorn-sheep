import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canonicalNetlifyHost } from "@/lib/deploy-origin";
import { exchangeFailureReason, joinFailureReason } from "@/lib/auth-callback";

/**
 * Magic-link landing. Supabase redirects here with a `code` after the user taps
 * the email link. We exchange it for a session (cookies are writable in a Route
 * Handler, unlike a Server Component), then — if the link carried an invite —
 * join the league via the SECURITY DEFINER RPC before dropping the user into the
 * app. Any failure routes back to /login with a reason the page can explain.
 *
 * Every failure also gets a `console.error` with the real detail. The reason
 * codes are deliberately coarse — they're user-facing copy keys — and for a
 * long time the coarsest of them, `link_expired`, was the *only* thing this
 * route ever said, about four unrelated causes, while logging nothing. A
 * misconfigured Site URL then looked exactly like an expired link. Read the
 * function logs before theorising.
 */
export async function GET(request: Request) {
  const { searchParams, origin, pathname, search, host } = new URL(request.url);

  // Netlify fronts the app, so the public host is the forwarded one. Used only
  // to recognise the host — `origin` above still drives every same-site
  // redirect, since `x-forwarded-host` carries no protocol to rebuild it with.
  const publicHost = request.headers.get("x-forwarded-host") ?? host;

  // The link landed on a deploy permalink, where the PKCE verifier cookie set
  // at sign-in time does not exist and never will. Move to the real site and
  // let that origin finish the exchange. See src/lib/deploy-origin.ts.
  const canonicalHost = canonicalNetlifyHost(publicHost);
  if (canonicalHost) {
    console.error(
      `[auth/callback] magic link landed on deploy permalink ${publicHost}; ` +
        `forwarding to ${canonicalHost}. Fix Supabase Auth → URL Configuration: Site URL ` +
        `must be the site's own origin, not a <deploy-id>--<site>.netlify.app permalink.`,
    );
    return NextResponse.redirect(`https://${canonicalHost}${pathname}${search}`);
  }

  const code = searchParams.get("code");
  const invite = searchParams.get("invite");

  // Only ever redirect to an internal /app path (open-redirect guard).
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/app") ? nextParam : "/app";

  if (!code) {
    console.error(`[auth/callback] no code on the request (host ${publicHost})`);
    return NextResponse.redirect(`${origin}/login?error=link_missing_code`);
  }

  // Read before the exchange: a failed exchange can clear the verifier cookie,
  // which would erase the very evidence we use to explain the failure.
  const cookieNames = (await cookies()).getAll().map((c) => c.name);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const reason = exchangeFailureReason(error, cookieNames);
    console.error(`[auth/callback] exchange failed as ${reason} on host ${publicHost}`, {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  if (invite) {
    const { error: joinError } = await supabase.rpc("join_by_invite", { p_code: invite });
    if (joinError) {
      const reason = joinFailureReason(joinError.message);
      console.error(`[auth/callback] join_by_invite failed as ${reason}`, joinError.message);
      return NextResponse.redirect(`${origin}/login?error=${reason}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

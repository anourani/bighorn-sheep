import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canonicalOrigin, publicOrigin } from "@/lib/deploy-origin";
import {
  exchangeFailureReason,
  hasVerifierCookie,
  joinFailureReason,
  verifyErrorReason,
  type CallbackError,
} from "@/lib/auth-callback";

/**
 * Magic-link landing, and the second hop of the link — `/auth/v1/verify` on
 * Supabase is the first. If it accepted the emailed token it sends us a `code`
 * to exchange for a session (cookies are writable in a Route Handler, unlike a
 * Server Component); if it rejected the token it sends `error`/`error_code`
 * instead and no `code` at all. Then, if the link carried an invite, we join the
 * league via the SECURITY DEFINER RPC before dropping the user into the app.
 *
 * Every failure routes back to /login with a stable reason and gets a
 * `console.error` carrying the real detail. That matters more than it sounds:
 * this route used to answer `link_expired` to four unrelated causes while
 * logging nothing, so "the link expired" was the app's guess printed over the
 * top of GoTrue's actual finding. Read the function logs before theorising.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams, pathname, search, host } = requestUrl;

  // NOT requestUrl.origin. Behind Netlify the host a handler sees can be the
  // running deploy's permalink, and redirecting there drops the visitor on an
  // origin their session cookies do not cover. See src/lib/deploy-origin.ts.
  const origin = publicOrigin(requestUrl);

  // Read before anything else: a failed exchange clears the verifier cookie, so
  // reading afterwards would erase the evidence used to explain the failure.
  const cookieNames = (await cookies()).getAll().map((c) => c.name);

  // Last-resort recovery for a link that landed on a deploy permalink *and* has
  // no verifier here — that combination cannot succeed on this origin. When the
  // verifier IS here the handshake started here too and completes fine, so
  // leave it alone: the redirect allowlist permits signing in from a permalink,
  // and bouncing would move the code to an origin that has no verifier at all.
  const canonicalSite = canonicalOrigin(host);
  if (canonicalSite && !hasVerifierCookie(cookieNames)) {
    console.error(
      `[auth/callback] link landed on deploy permalink ${host} with no verifier; ` +
        `forwarding to ${canonicalSite}. Sign-in should not start on a permalink — see ` +
        `src/lib/deploy-origin.ts.`,
    );
    return NextResponse.redirect(`${canonicalSite}${pathname}${search}`);
  }

  const invite = searchParams.get("invite");

  // Only ever redirect to an internal /app path (open-redirect guard).
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/app") ? nextParam : "/app";

  const fail = (reason: CallbackError) =>
    noStore(NextResponse.redirect(`${origin}/login?error=${reason}`));

  // GoTrue rejected the token before we ever saw a code. It said why; say that
  // rather than guessing, and log its exact words.
  const rejected = verifyErrorReason(searchParams);
  if (rejected) {
    console.error(`[auth/callback] verify rejected the token as ${rejected}`, {
      host,
      error: searchParams.get("error"),
      error_code: searchParams.get("error_code"),
      error_description: searchParams.get("error_description"),
    });
    return fail(rejected);
  }

  const code = searchParams.get("code");
  if (!code) {
    // No code and no error either — the link was truncated, or something
    // fetched this URL directly.
    console.error(`[auth/callback] no code and no error params (host ${host})`);
    return fail("link_missing_code");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const reason = exchangeFailureReason(error, cookieNames);
    console.error(`[auth/callback] exchange failed as ${reason} on host ${host}`, {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return fail(reason);
  }

  if (invite) {
    const { error: joinError } = await supabase.rpc("join_by_invite", { p_code: invite });
    if (joinError) {
      const reason = joinFailureReason(joinError.message);
      console.error(`[auth/callback] join_by_invite failed as ${reason}`, joinError.message);
      return fail(reason);
    }
  }

  return noStore(NextResponse.redirect(`${origin}${next}`));
}

/**
 * The emailed token is single-use, and this is a GET that spends it — so
 * anything that follows links on the user's behalf can burn a sign-in before
 * the person ever clicks. Corporate mail scanners do exactly that. These
 * headers don't stop a determined scanner, but they keep the response out of
 * every cache and out of search indexes, which is the cheap half of the fix.
 */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

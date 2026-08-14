import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { canonicalNetlifyHost } from "@/lib/deploy-origin";

/**
 * Auth boundary for the app.
 *
 * Two jobs, in this order:
 *   1. Refresh the Supabase session cookie on every request (via getUser()) so
 *      server components downstream see a live session.
 *   2. Gate routes: the product lives under /app and requires a session; the
 *      landing (/) and /login are for signed-out visitors.
 *
 * If Supabase isn't configured (no env vars — e.g. a bare preview or the mock
 * demo), we skip auth entirely and let every route through. The app still runs
 * on seed data; it just isn't gated.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured → no auth boundary. Let everything through untouched.
  if (!url || !key) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;

  // A magic link that landed anywhere but the callback. This happens when the
  // Supabase project's Site URL / redirect allowlist doesn't cover the origin we
  // asked for: GoTrue silently falls back to the Site URL and carries the `code`
  // along, so nothing ever exchanges it and the sign-in dies. Forward it to the
  // one route that knows what to do. Checked before the session round-trip since
  // it's a pure URL concern. The callback is excluded from this matcher, so
  // there's no loop, and it already guards `next` against open redirects.
  if (searchParams.has("code") && pathname !== "/auth/callback") {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/callback";

    // ...and if the Site URL it fell back to was a Netlify *deploy permalink*,
    // correct the host in the same hop. The PKCE verifier cookie lives on the
    // origin that requested the link, so exchanging here would fail no matter
    // what — the fallback host has to be left behind, not just the path.
    // Previews and branch deploys are their own origins and are left alone.
    const publicHost = request.headers.get("x-forwarded-host") ?? target.host;
    const canonicalHost = canonicalNetlifyHost(publicHost);
    if (canonicalHost) {
      // Loud on purpose. This safety net quietly completing the exchange on
      // whichever host it landed on is what hid a wrong Site URL for weeks.
      console.error(
        `[middleware] magic link landed on deploy permalink ${publicHost}; ` +
          `forwarding to ${canonicalHost}. Fix Supabase Auth → URL Configuration: Site URL ` +
          `must be the site's own origin, not a <deploy-id>--<site>.netlify.app permalink.`,
      );
      target.protocol = "https:";
      target.host = canonicalHost;
    }

    return NextResponse.redirect(target);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: getUser() (not getSession()) — it revalidates with the auth
  // server and refreshes the cookie. Do not run code between createServerClient
  // and getUser() or you can desync the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out visitor reaching the product → send to the landing page.
  if (!user && pathname.startsWith("/app")) {
    return redirectPreservingCookies(request, response, "/");
  }

  // Signed-in visitor on the front door → send them into the product.
  if (user && (pathname === "/" || pathname === "/login")) {
    return redirectPreservingCookies(request, response, "/app");
  }

  return response;
}

/** Redirect while carrying over any auth cookies refreshed onto `response`. */
function redirectPreservingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // Run on everything EXCEPT static assets, the auth callback (its own cookie
  // exchange must not be gated or it loops), the PWA files, and API routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|offline|auth/callback|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

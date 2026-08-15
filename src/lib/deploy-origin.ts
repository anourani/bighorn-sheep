/**
 * Recovering a magic link that landed on a Netlify *deploy permalink*.
 *
 * Netlify gives every deploy a permanent address of its own —
 * `https://<deploy-id>--<site>.netlify.app` — and shows it prominently on the
 * deploy page, which makes it very easy to paste somewhere that wanted the
 * site's actual address. Paste it into Supabase's **Site URL** and sign-in
 * breaks in a way that looks nothing like a URL problem:
 *
 *   1. `login/page.tsx` asks to return to `<site>.netlify.app/auth/callback`.
 *   2. That origin isn't on the redirect allowlist, so GoTrue discards it,
 *      substitutes the Site URL, and carries the `?code=` along.
 *   3. The link lands on the permalink host — a *different origin*. Sending the
 *      link stored a PKCE code-verifier cookie on `<site>.netlify.app`; it is
 *      host-only, and `netlify.app` is on the Public Suffix List, so it cannot
 *      be widened to cover both. The verifier is simply not there.
 *   4. `exchangeCodeForSession` has a code and no verifier, and fails.
 *
 * The user sees a perfectly good link report itself as expired. So when we spot
 * that host shape, send the browser to the same URL on the real site: the
 * verifier cookie is there, and the exchange goes through.
 *
 * The real fix is the Site URL setting — this only stops a config slip from
 * costing every invitee their sign-in. Callers log when it fires; the existing
 * `?code=` safety net in `middleware.ts` silently masked exactly this for long
 * enough that it is worth being loud about.
 */

/**
 * `<deploy-id>--<site>.netlify.app`, where the id is Netlify's 24-character hex
 * deploy id (an ObjectId, e.g. `6a7f9b1f91786e00086f40d4`).
 *
 * The id length is doing real work here. Deploy previews
 * (`deploy-preview-12--site`) and branch deploys (`main--site`) share the `--`
 * shape but are legitimately their own origins, with their own verifier
 * cookies — rewriting those would break preview sign-in rather than fix it.
 * Only a permalink, which is a second address for a deploy already reachable at
 * the canonical host, is safe to redirect.
 */
const DEPLOY_PERMALINK = /^[0-9a-f]{24}--(.+\.netlify\.app)$/i;

/**
 * The canonical site host this one is a deploy permalink of, or `null` if the
 * host is already canonical (or isn't Netlify at all).
 *
 * Never matches its own output, so a caller redirecting to it cannot loop.
 */
export function canonicalNetlifyHost(host: string): string | null {
  return DEPLOY_PERMALINK.exec(host)?.[1] ?? null;
}

/**
 * The same URL on the canonical site host, or `null` if it's already there.
 * Path and query are preserved untouched — the `code`, and any `next`/`invite`
 * that survived GoTrue's fallback, have to arrive intact.
 */
export function canonicalNetlifyUrl(url: URL): URL | null {
  const host = canonicalNetlifyHost(url.host);
  if (!host) return null;
  const canonical = new URL(url);
  canonical.host = host;
  // A permalink is always HTTPS; the canonical host is too.
  canonical.protocol = "https:";
  return canonical;
}

/**
 * The origin to build a redirect back to ourselves from.
 *
 * Not the same thing as `new URL(request.url).origin`. Behind Netlify, the host
 * a server handler sees is not necessarily the host the browser asked for — it
 * can be the running deploy's permalink. Redirecting to that address sends the
 * visitor to a *different origin*, where the session cookies just written do not
 * apply, so they arrive signed out on a frozen copy of the site. Worse, their
 * browser is now on the permalink, so the next sign-in they start from there
 * addresses its magic link back to the permalink too. The fault propagates.
 *
 * Deliberately derived from the URL alone, never from `x-forwarded-host`. A
 * request header is attacker-supplied unless a proxy is known to overwrite it,
 * and one used to build a redirect is an open redirect. The header would buy us
 * nothing here anyway: if the host is a permalink we already know the canonical
 * form, and if it is not, it is already right.
 *
 * The one case this does not cover is a custom domain — `<id>--site.netlify.app`
 * would canonicalise to `site.netlify.app` rather than the custom host. Revisit
 * if this app ever gets one; today it does not.
 */
export function publicOrigin(url: URL): string {
  const canonical = canonicalNetlifyHost(url.host);
  return canonical ? `https://${canonical}` : url.origin;
}

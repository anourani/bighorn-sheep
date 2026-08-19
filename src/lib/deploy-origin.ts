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
 * The site's own origin, from the build-time `NEXT_PUBLIC_APP_URL`, or `null`
 * when it cannot be used.
 *
 * Unlike `x-forwarded-host` — which this file refuses on open-redirect grounds,
 * see `publicOrigin` — this is a build-time constant set by the site owner in
 * the Netlify dashboard. It is not attacker-supplied, so it is safe to redirect
 * to. It is also deliberately blank outside production, which is why every
 * unusable shape has to fall back rather than throw:
 *
 * - blank or whitespace: a preview or branch build, where the variable is unset
 *   on purpose and the netlify.app host is the right answer.
 * - unparseable: a typo in the dashboard must not take sign-in down.
 * - a permalink itself: `canonicalNetlifyHost` is documented and tested as never
 *   matching its own output, so a caller cannot loop. That guarantee is only
 *   inherited if a permalink-shaped value here is rejected too.
 *
 * Returns the origin alone, so a trailing slash or a stray path in the variable
 * cannot leak into the redirect.
 */
function siteOrigin(appUrl: string | undefined): string | null {
  if (!appUrl?.trim()) return null;
  try {
    const parsed = new URL(appUrl);
    return canonicalNetlifyHost(parsed.host) ? null : parsed.origin;
  } catch {
    return null;
  }
}

/**
 * The origin a visitor who landed on a deploy permalink belongs on, or `null`
 * if this host is not a permalink.
 *
 * Prefers the custom domain and falls back to the netlify.app host the permalink
 * is a snapshot of. Both are correct in their own context: production knows its
 * own domain, and a preview build — where `NEXT_PUBLIC_APP_URL` is blank by
 * design — keeps exactly the behaviour this had before the domain existed.
 *
 * Null for previews, branch deploys, localhost and the canonical host itself,
 * **regardless of `appUrl`**. Those are real origins holding their own verifier
 * cookies; rewriting one to production would break sign-in there rather than
 * repair it, which is the whole reason `DEPLOY_PERMALINK` keys on the 24-char id.
 */
export function canonicalOrigin(
  host: string,
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): string | null {
  const netlifyHost = canonicalNetlifyHost(host);
  if (!netlifyHost) return null;
  return siteOrigin(appUrl) ?? `https://${netlifyHost}`;
}

/**
 * The same URL on the canonical origin, or `null` if it's already there.
 * Path and query are preserved untouched — the `code`, and any `next`/`invite`
 * that survived GoTrue's fallback, have to arrive intact.
 */
export function canonicalNetlifyUrl(url: URL, appUrl?: string): URL | null {
  const origin = canonicalOrigin(url.host, appUrl);
  if (!origin) return null;
  const target = new URL(origin);
  const canonical = new URL(url);
  // Protocol before host: a permalink is always HTTPS and so is the custom
  // domain, but taking both from the resolved origin keeps them consistent.
  canonical.protocol = target.protocol;
  canonical.host = target.host;
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
 * Deliberately derived from the URL and the build-time `NEXT_PUBLIC_APP_URL`,
 * never from `x-forwarded-host`. A request header is attacker-supplied unless a
 * proxy is known to overwrite it, and one used to build a redirect is an open
 * redirect. The header would buy us nothing here anyway: if the host is a
 * permalink we already know where it belongs, and if it is not, it is already
 * right.
 *
 * A permalink resolves to the custom domain in production and to the netlify.app
 * host everywhere else — see `canonicalOrigin`. Anything that is not a permalink
 * keeps its own origin.
 */
export function publicOrigin(url: URL, appUrl?: string): string {
  return canonicalOrigin(url.host, appUrl) ?? url.origin;
}

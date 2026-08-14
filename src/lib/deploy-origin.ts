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

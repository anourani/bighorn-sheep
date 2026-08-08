/**
 * Shared secret check for the Netlify functions that write to the database.
 *
 * `CRON_SECRET` has been documented in `.env.example` since the beginning and was
 * never read by anything — `poll-scores.ts` carried a comment claiming it checked
 * a secret while checking nothing. That was tolerable while the function was a
 * scheduled no-op; it is not tolerable now that an on-demand HTTP endpoint can
 * rewrite the entire schedule.
 *
 * Accepts the secret as either an `x-cron-secret` header (preferred) or a `key`
 * query parameter, because the point of the loader is that a non-technical user
 * can trigger it by opening a URL in a browser.
 */

export type CronAuth =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

export function checkCronSecret(request: Request, secret: string | undefined): CronAuth {
  if (!secret) {
    // Fail CLOSED. An unset secret must not mean "anyone may reload the
    // schedule"; the deployment is simply not finished.
    return {
      ok: false,
      status: 503,
      reason: "CRON_SECRET is not set in this environment, so this endpoint is disabled.",
    };
  }

  const url = new URL(request.url);
  const presented = request.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "";
  if (!timingSafeEqual(presented, secret)) {
    return { ok: false, status: 401, reason: "Missing or incorrect secret." };
  }
  return { ok: true };
}

/**
 * Constant-time-ish string compare. Not a substitute for crypto.timingSafeEqual,
 * but it avoids the trivially exploitable early-return of `===` on a secret that
 * is presented in a URL. Length is not secret here.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/*
 * There is deliberately NO "is this the platform calling?" helper here.
 *
 * Netlify's scheduled invocations cannot carry a custom header, so the tempting
 * move is to recognise the platform by its `user-agent` (or `x-nf-event`) and skip
 * the secret for those. Both are client-supplied strings: anyone can send
 * `user-agent: Netlify` and walk straight into the service-role write path, which
 * makes the check worse than no check — it reads like protection and isn't.
 *
 * So the split is by consequence instead. `load-schedule` is the new, expensive,
 * on-demand endpoint and requires the secret. `poll-scores` stays open, exactly as
 * it already was, because it must remain callable by the cron and because it is
 * idempotent: it derives everything from ESPN and recomputes standings from real
 * results, so triggering it repeatedly burns function minutes but cannot corrupt
 * data or reveal anything.
 */

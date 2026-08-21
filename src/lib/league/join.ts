/**
 * The one place that turns a `join_by_invite` failure into words.
 *
 * Three surfaces render these and they must not drift: the in-app code box
 * (`JoinByCode`), the banner on /app that reports an invite link followed while
 * already signed in, and the same banner reporting a join the auth callback
 * already attempted and lost. `JoinByCode` used to own a private dictionary; a
 * second copy of it was the obvious next step and the reason this module exists
 * instead.
 *
 * Pure, and deliberately free of any import: `middleware.ts` runs on the Edge
 * and pulls {@link normalizeInviteCode} out of here, so a `server-only` or a
 * React import anywhere in this file would break the build for everything.
 */

/**
 * Reason codes `joinGroup` and the auth callback can produce. Postgres text
 * never reaches the UI — the server action maps it to one of these first (see
 * `joinFailureReason` in auth-callback.ts, and `joinGroup` in actions.ts).
 */
export type JoinReason =
  | "entry_closed"
  | "invalid_code"
  | "join_failed"
  | "not_authenticated"
  | "unexpected_error";

/**
 * Copy for someone who typed a code into the app and it didn't take. They are
 * looking at the field they just used, so the advice is "try again".
 */
export const JOIN_ERROR_COPY: Record<string, string> = {
  invalid_code: "That code doesn't match a league. Check it and try again.",
  entry_closed: "Entry for that league has closed — it locks at the first Week 1 kickoff.",
  join_failed: "Couldn't join that league. Give it another try.",
  not_authenticated: "Your session expired — sign in again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

export const JOIN_ERROR_FALLBACK = "Couldn't join that league. Give it another try.";

/** What {@link JOIN_ERROR_COPY} says for `reason`, with the fallback applied. */
export function joinErrorCopy(reason: string): string {
  return JOIN_ERROR_COPY[reason] ?? JOIN_ERROR_FALLBACK;
}

/**
 * Copy for someone who followed an invite link and is now signed in without a
 * league — the auth callback's post-exchange failures, and a link followed while
 * already signed in.
 *
 * Deliberately NOT the dictionary above. Sign-in has already succeeded by the
 * time any of these fire, so "check it and try again" points at a field that
 * isn't in front of them and "sign in again" is advice they have just taken.
 * Every line therefore names the half that worked before the half that didn't,
 * and ends somewhere a person can actually go.
 */
export const JOIN_NOTICE_COPY: Record<string, string> = {
  entry_closed:
    "You're signed in, but entry to that league has closed — it locks at the first Week 1 kickoff. Ask your league admin.",
  invalid_code:
    "You're signed in, but that invite code no longer matches a league. Ask your admin for a fresh link.",
  join_failed:
    "You're signed in, but we couldn't add you to that league. Try the code below, or ask your admin.",
  not_authenticated: "Your session expired before we could add you to that league. Sign in again.",
  unexpected_error:
    "You're signed in, but something went wrong adding you to that league. Try the code below.",
};

export const JOIN_NOTICE_FALLBACK =
  "You're signed in, but we couldn't add you to that league. Try the code below, or ask your admin.";

/** What {@link JOIN_NOTICE_COPY} says for `reason`, with the fallback applied. */
export function joinNoticeCopy(reason: string): string {
  return JOIN_NOTICE_COPY[reason] ?? JOIN_NOTICE_FALLBACK;
}

/**
 * An invite code's shape, or null.
 *
 * `create_group` builds codes as 8 uppercase hex characters (0005), but this is
 * deliberately looser than that: codes predate the current generator, and a
 * guard that refuses a legitimate code silently drops a real invite. It is a
 * sanity check on length and character class, not a validity test — only
 * `join_by_invite` can say whether a code is real.
 *
 * Its actual job is at the boundary. `middleware.ts` reflects this value into a
 * redirect it builds, and while `URLSearchParams` encodes it either way, a
 * bounded character class means nothing surprising is ever carried forward.
 */
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9-]{1,32}$/.test(trimmed) ? trimmed : null;
}

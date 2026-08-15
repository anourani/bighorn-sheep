/**
 * The product's own name — the one identity that does NOT change with the
 * league you're viewing.
 *
 * It lives in a constant because the app names itself in nine places (this
 * header, `app/layout.tsx`'s metadata, `manifest.webmanifest`, the landing
 * page, the login explainer, `global-error.tsx`), and a second hardcoded
 * literal is how the browser tab and the header end up disagreeing.
 *
 * The other eight sites still say "Last Man Standing" and are a deliberate
 * follow-up: several are prose, not labels ("Last Man Standing is invite-only.
 * Ask a league admin…"), so the rename is a copy edit rather than a
 * substitution. Import this constant there rather than typing the string.
 */
export const APP_NAME = "Sheep with Glasses";

/**
 * The league's stake, as the account page prints it.
 *
 * A hardcoded literal because there is nowhere to read it from: the schema
 * tracks only WHETHER a member has paid (`group_members.buy_in_paid`, written
 * by an admin through the `set_member_buy_in` RPC — migration 0007), never HOW
 * MUCH. The design calls for an amount, so this is it.
 *
 * Two things are wrong with that and are accepted deliberately: the amount goes
 * stale silently if the stake ever changes, and it is per-league data rendered
 * as a global constant — correct only while the product runs one league. The
 * real fix is a `buy_in_amount` column on `groups` plus an admin control, which
 * needs a numbered migration applied to production by hand. Until then this is
 * the one line to change.
 */
export const BUY_IN_LABEL = "$20";

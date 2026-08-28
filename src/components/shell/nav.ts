/**
 * The app's navigation destinations, and the rule for which one you're on.
 *
 * Split out of `HeaderNav` because it is the only branching logic in the header
 * and this repo has no component tests — a plain module is testable the way the
 * other seventeen suites are. The components keep the markup; this keeps the
 * decisions. It stays JSX-free for that reason: `BOTTOM_TABS` carries a `key`
 * its consumer maps to an icon rather than the icon itself.
 */

/**
 * The two destinations inside the desktop tab pill. Account is deliberately not
 * one of them — the design pulls it out to the right edge as a button, which is
 * what separates "which page of the league am I reading" from "my own
 * settings".
 *
 * That separation is a DESKTOP one. The mobile bar brings Account back in as a
 * peer of the other two; see `BOTTOM_TABS`.
 */
export const TABS = [
  { key: "picks", href: "/app", label: "Picks" },
  { key: "standings", href: "/app/standings", label: "Standings" },
] as const;

export const ACCOUNT_HREF = "/app/account";

/**
 * The mobile bar's three destinations, spread from `TABS` rather than retyped
 * so the two navigations can never disagree about where a page lives — and so
 * `nav.test.ts`'s "never two active at once" invariant keeps covering every
 * destination by construction, rather than by someone remembering to extend a
 * second literal.
 *
 * Account is last because that is where the design's bar puts it.
 */
export const BOTTOM_TABS = [
  ...TABS,
  { key: "account", href: ACCOUNT_HREF, label: "Account" },
] as const;

export type TabKey = (typeof BOTTOM_TABS)[number]["key"];

/**
 * `/app` is the index of its own subtree, so a prefix match would light it up on
 * every child route — `/app/standings` would have two active tabs. Exact for it,
 * prefix for everything else, so a future `/app/account/edit` still counts as
 * Account.
 *
 * Prefix, not `startsWith` alone: `startsWith("/app")` would also match
 * `/apple`, and `startsWith("/app/account")` would match `/app/accountancy`. A
 * boundary check keeps a sibling route added later from silently lighting up its
 * neighbour.
 */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The app's navigation destinations, and the rule for which one you're on.
 *
 * Split out of `HeaderNav` because it is the only branching logic in the header
 * and this repo has no component tests — a plain module is testable the way the
 * other seventeen suites are. `HeaderNav` keeps the markup; this keeps the
 * decisions.
 */

/**
 * The two destinations inside the tab pill. Account is deliberately not one of
 * them — the design pulls it out to the right edge as a button, which is what
 * separates "which page of the league am I reading" from "my own settings".
 */
export const TABS = [
  { href: "/app", label: "Your Pick" },
  { href: "/app/standings", label: "Standings" },
] as const;

export const ACCOUNT_HREF = "/app/account";

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

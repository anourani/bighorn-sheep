/**
 * The app's navigation destinations, and the rule for which one you're on.
 *
 * Split out of `HeaderNav` because it is the only branching logic in the header
 * and this repo has no component tests — a plain module is testable the way the
 * other seventeen suites are. The components keep the markup; this keeps the
 * decisions. It stays JSX-free for that reason: `NAV_TABS` carries a `key` its
 * consumers map to an icon rather than the icon itself.
 */

export const ACCOUNT_HREF = "/app/account";

/**
 * The app's three destinations, in the order both navigations draw them.
 *
 * There used to be a two-item `TABS` beside this, because the desktop header
 * pulled Account out to the right edge as a round button while the mobile bar
 * carried it as a peer — so the two navs genuinely disagreed about what a "tab"
 * was. The desktop redesign made them agree: a centred pill of three equal
 * buttons, matching the bar at the foot of a phone. One list now, and the old
 * split is not worth preserving for its own sake.
 *
 * `key` is the discriminant a consumer maps to an icon (`BottomTabBar`) or to
 * the unpaid dot (both), so neither has to compare hrefs to decide what a row
 * is.
 */
export const NAV_TABS = [
  { key: "picks", href: "/app", label: "Picks" },
  { key: "standings", href: "/app/standings", label: "Standings" },
  { key: "account", href: ACCOUNT_HREF, label: "Account" },
] as const;

export type TabKey = (typeof NAV_TABS)[number]["key"];

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

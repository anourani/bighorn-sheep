import { describe, expect, it } from "vitest";
import { ACCOUNT_HREF, NAV_TABS, isActive } from "./nav";

describe("isActive", () => {
  it("matches /app exactly, and not its children", () => {
    expect(isActive("/app", "/app")).toBe(true);
    // The trap: a prefix match here lights up two tabs at once on every child.
    expect(isActive("/app", "/app/standings")).toBe(false);
    expect(isActive("/app", "/app/account")).toBe(false);
  });

  it("matches a child route and its own subtree", () => {
    expect(isActive("/app/standings", "/app/standings")).toBe(true);
    expect(isActive(ACCOUNT_HREF, "/app/account")).toBe(true);
    expect(isActive(ACCOUNT_HREF, "/app/account/edit")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isActive("/app", "/apple")).toBe(false);
    expect(isActive(ACCOUNT_HREF, "/app/accountancy")).toBe(false);
    expect(isActive("/app/standings", "/app/standings-archive")).toBe(false);
  });

  it("is false off the app entirely", () => {
    for (const { href } of NAV_TABS) {
      expect(isActive(href, "/")).toBe(false);
      expect(isActive(href, "/login")).toBe(false);
    }
    expect(isActive(ACCOUNT_HREF, "/login")).toBe(false);
  });

  it("never reports two tabs active at once", () => {
    // Over NAV_TABS rather than a hand-built list, so the invariant tracks
    // every destination by construction — a fourth one is covered the moment it
    // is added, instead of when someone remembers to extend a literal here.
    for (const pathname of [
      "/app",
      "/app/standings",
      "/app/account",
      "/app/account/edit",
      "/login",
    ]) {
      const lit = NAV_TABS.map((t) => t.href).filter((href) => isActive(href, pathname));
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * The destination list both navigations render. Everything here is a property of
 * the data, because there is no jsdom in this repo and nothing renders either
 * `BottomTabBar` or `HeaderNav`.
 */
describe("NAV_TABS", () => {
  it("is the app's three destinations, in the order both navs draw them", () => {
    // One list, read by the desktop pill and the mobile bar alike, so the two
    // cannot disagree about where a page lives. It used to be spread from a
    // two-item list — that split existed only while the desktop header pulled
    // Account out to the right edge as a round button, and asserting the spread
    // would now be a literal checked against itself.
    expect(NAV_TABS.map((t) => t.href)).toEqual(["/app", "/app/standings", ACCOUNT_HREF]);
  });

  it("puts Account last, where the design's bar puts it", () => {
    expect(NAV_TABS.at(-1)?.href).toBe(ACCOUNT_HREF);
  });

  it("has a distinct key per tab", () => {
    // `BottomTabBar` keys its icon map on these, and both navs key the unpaid
    // dot on them. A duplicate typechecks fine and silently draws twice.
    const keys = NAV_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores labels in sentence case, leaving the uppercasing to CSS", () => {
    // Load-bearing for accessibility, not style: the Account tab's `aria-label`
    // is "Account — buy-in unpaid" when the buy-in is due, and WCAG 2.5.3 Label
    // in Name holds only because the visible label is a substring of it.
    for (const { label } of NAV_TABS) {
      expect(label).not.toBe(label.toUpperCase());
    }
  });

  it("lights exactly one tab on every app route, and none off the app", () => {
    // Stronger than the "at most one" invariant above, and it is the bar's
    // actual contract: three tabs, one of them always current.
    for (const pathname of ["/app", "/app/standings", "/app/account", "/app/account/edit"]) {
      const lit = NAV_TABS.filter(({ href }) => isActive(href, pathname));
      expect(lit, `expected exactly one active tab on ${pathname}`).toHaveLength(1);
    }
    expect(NAV_TABS.filter(({ href }) => isActive(href, "/login"))).toHaveLength(0);
  });
});

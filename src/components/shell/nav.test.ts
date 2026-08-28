import { describe, expect, it } from "vitest";
import { ACCOUNT_HREF, BOTTOM_TABS, TABS, isActive } from "./nav";

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
    for (const { href } of TABS) {
      expect(isActive(href, "/")).toBe(false);
      expect(isActive(href, "/login")).toBe(false);
    }
    expect(isActive(ACCOUNT_HREF, "/login")).toBe(false);
  });

  it("never reports two tabs active at once", () => {
    // Over BOTTOM_TABS rather than a hand-built list, so the invariant tracks
    // every destination by construction — a fourth one is covered the moment it
    // is added, instead of when someone remembers to extend a literal here.
    for (const pathname of [
      "/app",
      "/app/standings",
      "/app/account",
      "/app/account/edit",
      "/login",
    ]) {
      const lit = BOTTOM_TABS.map((t) => t.href).filter((href) => isActive(href, pathname));
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * The mobile bar's destination list. Everything here is a property of the data,
 * because there is no jsdom in this repo and nothing renders `BottomTabBar`.
 */
describe("BOTTOM_TABS", () => {
  it("is the desktop tabs plus Account, spread rather than retyped", () => {
    // If this ever has to be written out by hand, the two navigations can
    // disagree about where a page lives and nothing will say so.
    expect(BOTTOM_TABS.map((t) => t.href)).toEqual([...TABS.map((t) => t.href), ACCOUNT_HREF]);
  });

  it("puts Account last, where the design's bar puts it", () => {
    expect(BOTTOM_TABS.at(-1)?.href).toBe(ACCOUNT_HREF);
  });

  it("has a distinct key per tab", () => {
    // `BottomTabBar` keys its icon map on these. A duplicate typechecks fine and
    // silently draws the same glyph twice.
    const keys = BOTTOM_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores labels in sentence case, leaving the uppercasing to CSS", () => {
    // Load-bearing for accessibility, not style: the Account tab's `aria-label`
    // is "Account — buy-in unpaid" when the buy-in is due, and WCAG 2.5.3 Label
    // in Name holds only because the visible label is a substring of it.
    for (const { label } of BOTTOM_TABS) {
      expect(label).not.toBe(label.toUpperCase());
    }
  });

  it("lights exactly one tab on every app route, and none off the app", () => {
    // Stronger than the "at most one" invariant above, and it is the bar's
    // actual contract: three tabs, one of them always current.
    for (const pathname of ["/app", "/app/standings", "/app/account", "/app/account/edit"]) {
      const lit = BOTTOM_TABS.filter(({ href }) => isActive(href, pathname));
      expect(lit, `expected exactly one active tab on ${pathname}`).toHaveLength(1);
    }
    expect(BOTTOM_TABS.filter(({ href }) => isActive(href, "/login"))).toHaveLength(0);
  });
});

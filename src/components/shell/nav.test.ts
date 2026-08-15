import { describe, expect, it } from "vitest";
import { ACCOUNT_HREF, TABS, isActive } from "./nav";

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
    for (const pathname of ["/app", "/app/standings", "/app/account", "/login"]) {
      const lit = [...TABS.map((t) => t.href), ACCOUNT_HREF].filter((href) =>
        isActive(href, pathname),
      );
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });
});

import { describe, expect, it } from "vitest";
import { nextTabIndex, panelId, tabId } from "./tabs";

describe("nextTabIndex", () => {
  it("steps left and right", () => {
    expect(nextTabIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(2, "ArrowLeft", 3)).toBe(1);
  });

  it("wraps at both ends, unlike the week strip's clamping equivalent", () => {
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
  });

  it("jumps to the ends", () => {
    expect(nextTabIndex(1, "Home", 3)).toBe(0);
    expect(nextTabIndex(1, "End", 3)).toBe(2);
  });

  it("returns null for keys that aren't ours, so they keep their behaviour", () => {
    // Up/Down must still scroll the page; Tab must still leave the tablist.
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "a"]) {
      expect(nextTabIndex(0, key, 3)).toBeNull();
    }
  });

  it("survives an empty list and an out-of-range current", () => {
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
    expect(nextTabIndex(-1, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(99, "ArrowLeft", 3)).toBe(2);
  });

  it("is a no-op cycle on a single tab", () => {
    expect(nextTabIndex(0, "ArrowRight", 1)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 1)).toBe(0);
  });
});

describe("tab ids", () => {
  it("gives a tab and its panel distinct, stable ids", () => {
    expect(tabId("admin", "members")).toBe("admin-tab-members");
    expect(panelId("admin", "members")).toBe("admin-panel-members");
    expect(tabId("admin", "members")).not.toBe(panelId("admin", "members"));
  });
});

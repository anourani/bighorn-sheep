import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, nextFocusIndex } from "./drawer";

describe("nextFocusIndex", () => {
  it("leaves the interior to the browser", () => {
    // The whole design: intervening here would fight the tablist's roving
    // tabindex and the rules fieldset's native radio group.
    expect(nextFocusIndex(1, 4, false)).toBeNull();
    expect(nextFocusIndex(2, 4, false)).toBeNull();
    expect(nextFocusIndex(1, 4, true)).toBeNull();
    expect(nextFocusIndex(2, 4, true)).toBeNull();
  });

  it("wraps at both ends so focus cannot reach the page behind", () => {
    expect(nextFocusIndex(3, 4, false)).toBe(0);
    expect(nextFocusIndex(0, 4, true)).toBe(3);
  });

  it("does not wrap at the end you are moving away from", () => {
    expect(nextFocusIndex(0, 4, false)).toBeNull();
    expect(nextFocusIndex(3, 4, true)).toBeNull();
  });

  it("enters from the panel itself at whichever end you tabbed towards", () => {
    // -1 is focus on the panel (tabIndex -1, so not in the list) — the state
    // every drawer opens in.
    expect(nextFocusIndex(-1, 4, false)).toBe(0);
    expect(nextFocusIndex(-1, 4, true)).toBe(3);
  });

  it("is null for an empty panel rather than throwing", () => {
    expect(nextFocusIndex(-1, 0, false)).toBeNull();
    expect(nextFocusIndex(0, 0, true)).toBeNull();
  });

  it("keeps a single focusable element on itself", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });
});

describe("FOCUSABLE_SELECTOR", () => {
  it("excludes disabled controls — the rules fieldset disables its radios wholesale", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTOR).toContain("input:not([disabled])");
  });

  it("excludes tabIndex -1, which is what the panel and the scrim carry", () => {
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });
});

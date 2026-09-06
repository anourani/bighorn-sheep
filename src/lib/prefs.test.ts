import { describe, expect, it } from "vitest";
import { PICKS_ENTRY_KEY, PICKS_LAYOUT_KEY, readStoredChoice } from "./prefs";

const LAYOUTS = ["grid", "matchups"] as const;

describe("readStoredChoice", () => {
  it("returns a stored value that is still one of the options", () => {
    expect(readStoredChoice("matchups", LAYOUTS, "grid")).toBe("matchups");
  });

  it("falls back when the key is absent", () => {
    // localStorage.getItem returns null, not undefined, for a missing key —
    // but a caller reading through an optional chain hands us undefined.
    expect(readStoredChoice(null, LAYOUTS, "grid")).toBe("grid");
    expect(readStoredChoice(undefined, LAYOUTS, "grid")).toBe("grid");
  });

  it("falls back on a value an older build wrote", () => {
    expect(readStoredChoice("list", LAYOUTS, "grid")).toBe("grid");
  });

  it("falls back on junk from another script on the origin", () => {
    expect(readStoredChoice("", LAYOUTS, "grid")).toBe("grid");
    expect(readStoredChoice("[object Object]", LAYOUTS, "grid")).toBe("grid");
  });
});

describe("the storage keys", () => {
  /*
   * Namespaced so they can be found and cleared as a group, and DISTINCT so one
   * cannot overwrite the other. Spelled out rather than compared to each other:
   * the value is a wire format living in people's browsers, and renaming a key
   * silently resets everyone who had chosen something.
   */
  it("are namespaced and distinct", () => {
    expect(PICKS_LAYOUT_KEY).toBe("lms:picks:layout");
    expect(PICKS_ENTRY_KEY).toBe("lms:picks:entry");
  });

  /*
   * The entry choice is stored as a string because `readStoredChoice` narrows
   * against a union of strings. A "3" from a future build that raised the cap —
   * or a "2" belonging to an entry since removed — must fall back rather than
   * reach a switcher that has no such tab.
   */
  it("narrows the entry choice to a tab that exists", () => {
    const ENTRIES = ["1", "2"] as const;
    expect(readStoredChoice("2", ENTRIES, "1")).toBe("2");
    expect(readStoredChoice("3", ENTRIES, "1")).toBe("1");
    expect(readStoredChoice(null, ENTRIES, "1")).toBe("1");
  });
});

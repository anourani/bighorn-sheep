import { describe, expect, it } from "vitest";
import { readStoredChoice } from "./prefs";

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

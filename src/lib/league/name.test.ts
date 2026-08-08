import { describe, expect, it } from "vitest";
import { formatDisplayName, initials } from "./name";

describe("formatDisplayName", () => {
  it("renders First L.", () => {
    expect(formatDisplayName("Alex", "Nourani")).toBe("Alex N.");
  });

  it("uppercases the last initial regardless of input case", () => {
    expect(formatDisplayName("mark", "rivera")).toBe("mark R.");
  });

  it("drops the initial when there is no last name", () => {
    expect(formatDisplayName("Alex", "")).toBe("Alex");
    expect(formatDisplayName("Alex", null)).toBe("Alex");
  });

  it("uses the fallback when both names are empty", () => {
    expect(formatDisplayName("", "")).toBe("Player");
    expect(formatDisplayName(null, undefined, "guest")).toBe("guest");
  });

  it("trims surrounding whitespace", () => {
    expect(formatDisplayName("  Alex  ", "  Nourani  ")).toBe("Alex N.");
  });

  it("handles a last-name-only profile", () => {
    expect(formatDisplayName("", "Rivera")).toBe("R.");
  });

  it("preserves accented characters", () => {
    expect(formatDisplayName("Zoë", "Ñuñez")).toBe("Zoë Ñ.");
  });
});

describe("initials", () => {
  it("combines first and last initials", () => {
    expect(initials("Alex", "Nourani")).toBe("AN");
  });

  it("falls back to two letters of the first name when no last name", () => {
    expect(initials("Alex", "")).toBe("AL");
    expect(initials("Jo", null)).toBe("JO");
  });

  it("never returns empty", () => {
    expect(initials("", "")).toBe("?");
    expect(initials(null, undefined)).toBe("?");
  });

  it("uses the last name alone when only it is present", () => {
    expect(initials("", "Rivera")).toBe("RI");
  });
});

import { describe, expect, it } from "vitest";
import { formatDisplayName, formatFullName, initials, sortRosterByName } from "./name";

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

describe("formatFullName", () => {
  it("renders First Last", () => {
    expect(formatFullName("Alex", "Nourani")).toBe("Alex Nourani");
  });

  it("preserves the input casing", () => {
    expect(formatFullName("mark", "rivera")).toBe("mark rivera");
  });

  it("drops the space when there is no last name", () => {
    expect(formatFullName("Alex", "")).toBe("Alex");
    expect(formatFullName("Alex", null)).toBe("Alex");
  });

  it("does NOT abbreviate a last-name-only profile, unlike formatDisplayName", () => {
    expect(formatFullName("", "Rivera")).toBe("Rivera");
    expect(formatDisplayName("", "Rivera")).toBe("R.");
  });

  it("uses the fallback when both names are empty", () => {
    expect(formatFullName("", "")).toBe("Player");
    expect(formatFullName(null, undefined, "guest")).toBe("guest");
  });

  it("trims surrounding whitespace", () => {
    expect(formatFullName("  Alex  ", "  Nourani  ")).toBe("Alex Nourani");
  });

  it("preserves accented characters", () => {
    expect(formatFullName("Zoë", "Ñuñez")).toBe("Zoë Ñuñez");
  });
});

describe("sortRosterByName", () => {
  const member = (id: string, firstName: string, lastName: string) => ({
    id,
    firstName,
    lastName,
  });

  const names = (rows: readonly { firstName: string; lastName: string }[]) =>
    rows.map((r) => formatFullName(r.firstName, r.lastName));

  it("orders by first name, which is what the column shows", () => {
    const sorted = sortRosterByName([
      member("c", "Priya", "Rao"),
      member("a", "Alex", "Nourani"),
      member("b", "Jane", "Adams"),
    ]);
    expect(names(sorted)).toEqual(["Alex Nourani", "Jane Adams", "Priya Rao"]);
  });

  it("falls through to the last name when first names match", () => {
    const sorted = sortRosterByName([
      member("a", "Alex", "Nourani"),
      member("b", "Alex", "Adams"),
    ]);
    expect(names(sorted)).toEqual(["Alex Adams", "Alex Nourani"]);
  });

  it("does not split neighbours on case or accents", () => {
    const sorted = sortRosterByName([
      member("c", "alex", "Zane"),
      member("a", "Alex", "Adams"),
      member("b", "Álex", "Mora"),
    ]);
    expect(names(sorted)).toEqual(["Alex Adams", "Álex Mora", "alex Zane"]);
  });

  it("breaks a tie on id, so equal labels still have a fixed order", () => {
    const sorted = sortRosterByName([
      member("b2", "Alex", "Nourani"),
      member("a1", "Alex", "Nourani"),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["a1", "b2"]);
  });

  it("gives every unnamed profile the same fallback label and orders them by id", () => {
    const sorted = sortRosterByName([
      member("z", "", ""),
      member("a", "", ""),
      member("m", "Alex", "Nourani"),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["m", "a", "z"]);
    expect(names(sorted)).toEqual(["Alex Nourani", "Player", "Player"]);
  });

  it("returns a new array and leaves the caller's untouched", () => {
    const input = [member("b", "Jane", "Adams"), member("a", "Alex", "Nourani")];
    const sorted = sortRosterByName(input);
    expect(sorted).not.toBe(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("carries extra fields through untouched", () => {
    const sorted = sortRosterByName([
      { ...member("a", "Jane", "Adams"), buyInPaid: true },
      { ...member("b", "Alex", "Nourani"), buyInPaid: false },
    ]);
    expect(sorted.map((m) => m.buyInPaid)).toEqual([false, true]);
  });
});

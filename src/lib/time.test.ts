import { describe, expect, it } from "vitest";
import { formatLong } from "./time";

/**
 * en-US separates the clock from AM/PM with U+202F (narrow no-break space), and
 * has changed its mind about that between ICU releases. Normalising keeps these
 * assertions about the *format* rather than about the runtime's whitespace.
 */
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("formatLong", () => {
  it("spells out the weekday, month, ordinal day, time and zone", () => {
    expect(norm(formatLong("2026-03-21T23:30:00Z", { timeZone: "America/New_York" }))).toBe(
      "Saturday, March 21st at 7:30 PM EDT",
    );
  });

  it("renders the same instant in the viewer's own zone", () => {
    const iso = "2026-03-21T23:30:00Z";
    expect(norm(formatLong(iso, { timeZone: "America/Los_Angeles" }))).toBe(
      "Saturday, March 21st at 4:30 PM PDT",
    );
    // Far enough west that the local date is the following day, which is the
    // whole reason the weekday is formatted in the target zone and not UTC.
    expect(norm(formatLong(iso, { timeZone: "Asia/Tokyo" }))).toBe(
      "Sunday, March 22nd at 8:30 AM GMT+9",
    );
  });

  // The abbreviation is resolved against the kickoff, not against "now" — a
  // January game read during the season must not pick up summer's offset.
  it("uses the zone abbreviation in force at kickoff", () => {
    expect(norm(formatLong("2026-01-04T18:00:00Z", { timeZone: "America/New_York" }))).toBe(
      "Sunday, January 4th at 1:00 PM EST",
    );
  });

  it("suffixes days correctly, including the 11-13 exceptions", () => {
    const at = (day: string) =>
      norm(formatLong(`2026-09-${day}T16:00:00Z`, { timeZone: "UTC" })).split(" at ")[0]!;

    expect(at("01")).toBe("Tuesday, September 1st");
    expect(at("02")).toBe("Wednesday, September 2nd");
    expect(at("03")).toBe("Thursday, September 3rd");
    expect(at("04")).toBe("Friday, September 4th");
    expect(at("11")).toBe("Friday, September 11th");
    expect(at("12")).toBe("Saturday, September 12th");
    expect(at("13")).toBe("Sunday, September 13th");
    expect(at("21")).toBe("Monday, September 21st");
    expect(at("22")).toBe("Tuesday, September 22nd");
    expect(at("23")).toBe("Wednesday, September 23rd");
    expect(at("30")).toBe("Wednesday, September 30th");
  });

  // formatToParts throws on an invalid date where toLocaleDateString merely says
  // "Invalid Date". One bad kickoff row should not blank the picks page.
  it("returns empty rather than throwing on an unparseable timestamp", () => {
    expect(formatLong("not-a-date")).toBe("");
  });
});

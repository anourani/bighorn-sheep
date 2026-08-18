import { describe, expect, it } from "vitest";
import {
  formatClockZone,
  formatDate,
  formatFull,
  formatLong,
  formatMonthDay,
  formatWeekdayDate,
} from "./time";

/**
 * en-US separates the clock from AM/PM with U+202F (narrow no-break space), and
 * has changed its mind about that between ICU releases. Normalising keeps these
 * assertions about the *format* rather than about the runtime's whitespace.
 */
const norm = (s: string) => s.replace(/[  ]/g, " ");

// The kickoff the picks hero splits across two lines: Sunday 13 September 2026,
// 4:00 PM in New York (September, so the zone is EDT — the mock-up's "EST" is
// filler text, not a case to reproduce).
const KICKOFF = "2026-09-13T20:00:00Z";
const NY = { timeZone: "America/New_York" };

describe("formatDate", () => {
  it("gives the date with no time attached", () => {
    expect(formatDate(KICKOFF, NY)).toBe("Sun, Sep 13");
  });

  // Same instant, and the calendar day itself differs — the weekday and day
  // number have to be resolved in the target zone, not in UTC.
  it("resolves the day in the viewer's zone", () => {
    expect(formatDate(KICKOFF, { timeZone: "Asia/Tokyo" })).toBe("Mon, Sep 14");
  });
});

describe("formatClockZone", () => {
  it("names the zone, which formatClock leaves off", () => {
    expect(norm(formatClockZone(KICKOFF, NY))).toBe("4:00 PM EDT");
  });

  // As with formatLong: the abbreviation is the one in force at kickoff, so a
  // January game read mid-season does not pick up summer's offset.
  it("uses the zone abbreviation in force at kickoff", () => {
    expect(norm(formatClockZone("2026-01-04T18:00:00Z", NY))).toBe("1:00 PM EST");
  });
});

// formatFull is now composed from formatDate; it must still read exactly as it
// did before the split, since every other kickoff line in the app is this one.
describe("formatFull", () => {
  it("joins the date and the bare clock with a middot", () => {
    expect(norm(formatFull(KICKOFF, NY))).toBe("Sun, Sep 13 · 4:00 PM");
  });
});

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

describe("formatMonthDay", () => {
  it("gives a bare numeric date", () => {
    expect(formatMonthDay(KICKOFF, NY)).toBe("9/13");
  });

  it("is month-first regardless of the runtime locale", () => {
    // Pinned to en-US: the buy-in card shows 10/21, and a browser on en-GB
    // must not silently turn that into 21/10 next to a dollar amount.
    expect(formatMonthDay("2026-10-21T16:00:00Z", NY)).toBe("10/21");
  });

  it("resolves in the given zone, not UTC", () => {
    // 00:30 UTC on the 14th is still the 13th in New York.
    expect(formatMonthDay("2026-09-14T00:30:00Z", NY)).toBe("9/13");
  });

  it("returns empty on an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(formatMonthDay("not a date")).toBe("");
  });
});

describe("formatWeekdayDate", () => {
  it("gives the weekday and date with no ordinal and no clock", () => {
    expect(formatWeekdayDate(KICKOFF, NY)).toBe("Sunday, September 13");
  });

  it("differs from formatLong, which is for kickoffs", () => {
    expect(formatWeekdayDate(KICKOFF, NY)).not.toBe(norm(formatLong(KICKOFF, NY)));
  });

  it("returns empty on an unparseable timestamp", () => {
    expect(formatWeekdayDate("")).toBe("");
  });
});

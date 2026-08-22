import { describe, expect, it } from "vitest";
import {
  formatClockZone,
  formatDate,
  formatFull,
  formatLong,
  formatMonthDayClock,
  formatWeekdayDate,
  formatWeekdayDateOrdinal,
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

describe("formatMonthDayClock", () => {
  it("gives a numeric date and a clock", () => {
    expect(formatMonthDayClock(KICKOFF, NY)).toBe("9/13, 4:00 PM");
  });

  it("distinguishes two stamps on the same day — the whole reason it has a time", () => {
    // The bug this replaced: an admin toggling a buy-in switch off and back on
    // the same afternoon saw the date beside it never change, because a
    // month/day format collapsed two different writes onto one string.
    const morning = formatMonthDayClock("2026-10-21T14:05:00Z", NY);
    const afternoon = formatMonthDayClock("2026-10-21T19:47:00Z", NY);
    expect(morning).toBe("10/21, 10:05 AM");
    expect(afternoon).toBe("10/21, 3:47 PM");
    expect(morning).not.toBe(afternoon);
  });

  it("is month-first regardless of the runtime locale", () => {
    // Pinned to en-US: the buy-in card shows 10/21, and a browser on en-GB
    // must not silently turn that into 21/10 next to a dollar amount.
    expect(formatMonthDayClock("2026-10-21T16:00:00Z", NY)).toBe("10/21, 12:00 PM");
  });

  it("resolves in the given zone, not UTC", () => {
    // 00:30 UTC on the 14th is still the 13th in New York.
    expect(formatMonthDayClock("2026-09-14T00:30:00Z", NY)).toBe("9/13, 8:30 PM");
  });

  it("returns empty on an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(formatMonthDayClock("not a date")).toBe("");
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

describe("formatWeekdayDateOrdinal", () => {
  it("gives the weekday and an ordinal date with no clock", () => {
    expect(formatWeekdayDateOrdinal(KICKOFF, NY)).toBe("Sunday, September 13th");
  });

  it("suffixes days correctly, including the 11-13 exceptions", () => {
    const on = (day: string) =>
      formatWeekdayDateOrdinal(`2026-09-${day}T16:00:00Z`, { timeZone: "UTC" });

    expect(on("01")).toBe("Tuesday, September 1st");
    expect(on("02")).toBe("Wednesday, September 2nd");
    expect(on("03")).toBe("Thursday, September 3rd");
    expect(on("04")).toBe("Friday, September 4th");
    expect(on("11")).toBe("Friday, September 11th");
    expect(on("12")).toBe("Saturday, September 12th");
    expect(on("13")).toBe("Sunday, September 13th");
    expect(on("21")).toBe("Monday, September 21st");
    expect(on("22")).toBe("Tuesday, September 22nd");
    expect(on("23")).toBe("Wednesday, September 23rd");
    expect(on("30")).toBe("Wednesday, September 30th");
  });

  it("resolves in the given zone, so a late kickoff can read as the day before", () => {
    // 00:20 UTC on the 10th is still the evening of the 9th in New York — and
    // the invite card shows only the date, so this is the whole difference the
    // reader sees when LocalTime swaps zones after mount.
    expect(formatWeekdayDateOrdinal("2026-09-10T00:20:00Z", NY)).toBe("Wednesday, September 9th");
    expect(formatWeekdayDateOrdinal("2026-09-10T00:20:00Z", { timeZone: "UTC" })).toBe("Thursday, September 10th");
  });

  // The strongest single assertion here, and what pins the shared `ordinalDate`
  // body: the two formatters may only ever differ by the clock.
  it("is formatLong with the clock removed", () => {
    expect(formatWeekdayDateOrdinal(KICKOFF, NY)).toBe(
      norm(formatLong(KICKOFF, NY)).split(" at ")[0],
    );
  });

  it("differs from formatWeekdayDate, which drops the ordinal on purpose", () => {
    expect(formatWeekdayDateOrdinal(KICKOFF, NY)).not.toBe(formatWeekdayDate(KICKOFF, NY));
  });

  it("differs from formatLong, which also carries the time", () => {
    expect(formatWeekdayDateOrdinal(KICKOFF, NY)).not.toBe(norm(formatLong(KICKOFF, NY)));
  });

  it("returns empty on an unparseable timestamp rather than throwing", () => {
    expect(formatWeekdayDateOrdinal("not a date")).toBe("");
  });
});

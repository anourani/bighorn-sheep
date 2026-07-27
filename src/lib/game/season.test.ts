import { describe, expect, it } from "vitest";
import { isEntryOpen, resolveCurrentWeek, seasonPhase } from "./season";

const ENTRY = new Date("2025-09-05T00:20:00.000Z"); // first Week 1 kickoff

describe("seasonPhase", () => {
  it("is preseason before the first Week 1 kickoff", () => {
    expect(seasonPhase(ENTRY, new Date("2025-08-28T12:00:00.000Z"))).toBe("preseason");
  });

  it("is regular once entry has closed", () => {
    expect(seasonPhase(ENTRY, new Date("2025-10-12T17:30:00.000Z"))).toBe("regular");
  });

  it("treats the exact kickoff instant as no-longer-preseason", () => {
    expect(seasonPhase(ENTRY, ENTRY)).toBe("regular");
  });

  it("is ended when the caller says the season resolved, regardless of clock", () => {
    expect(seasonPhase(ENTRY, new Date("2025-08-01T00:00:00.000Z"), true)).toBe("ended");
  });
});

describe("isEntryOpen", () => {
  it("mirrors the preseason window", () => {
    expect(isEntryOpen(ENTRY, new Date("2025-08-28T12:00:00.000Z"))).toBe(true);
    expect(isEntryOpen(ENTRY, new Date("2025-09-06T00:00:00.000Z"))).toBe(false);
  });
});

describe("resolveCurrentWeek", () => {
  const games = [
    { week: 1, kickoff: "2025-09-05T00:20:00.000Z" },
    { week: 2, kickoff: "2025-09-12T00:20:00.000Z" },
    { week: 3, kickoff: "2025-09-19T00:20:00.000Z" },
  ];

  it("is always Week 1 in preseason", () => {
    expect(
      resolveCurrentWeek({ phase: "preseason", now: new Date("2025-08-28T00:00:00.000Z"), games }),
    ).toBe(1);
  });

  it("returns the greatest week that has already begun", () => {
    expect(
      resolveCurrentWeek({ phase: "regular", now: new Date("2025-09-14T00:00:00.000Z"), games }),
    ).toBe(2);
  });

  it("falls back to Week 1 before any week has begun", () => {
    expect(
      resolveCurrentWeek({ phase: "regular", now: new Date("2025-09-01T00:00:00.000Z"), games }),
    ).toBe(1);
  });

  it("caps at finalWeek", () => {
    expect(
      resolveCurrentWeek({
        phase: "regular",
        now: new Date("2030-01-01T00:00:00.000Z"),
        games: [{ week: 25, kickoff: "2025-09-05T00:20:00.000Z" }],
        finalWeek: 18,
      }),
    ).toBe(18);
  });
});

import { describe, expect, it } from "vitest";
import type { Game, SeasonType, TeamId } from "../nfl/types";
import { emptyRecord, formatRecord, recordsThroughWeek } from "./records";

function game(
  week: number,
  home: TeamId,
  away: TeamId,
  scores?: { home: number; away: number },
  overrides: Partial<Game> = {},
): Game {
  return {
    id: `g_w${week}_${home}_${away}`,
    season: 2025,
    seasonType: "regular" as SeasonType,
    week,
    kickoff: `2025-09-${String(6 + week).padStart(2, "0")}T17:00:00.000Z`,
    status: scores ? "final" : "scheduled",
    home,
    away,
    homeScore: scores?.home ?? null,
    awayScore: scores?.away ?? null,
    ...overrides,
  };
}

describe("recordsThroughWeek", () => {
  it("counts a win for the winner and a loss for the loser", () => {
    const records = recordsThroughWeek([game(1, "kc", "buf", { home: 24, away: 17 })], 2);
    expect(records.get("kc")).toEqual({ w: 1, l: 0, t: 0 });
    expect(records.get("buf")).toEqual({ w: 0, l: 1, t: 0 });
  });

  it("counts a tie for both sides", () => {
    const records = recordsThroughWeek([game(1, "kc", "buf", { home: 20, away: 20 })], 2);
    expect(records.get("kc")).toEqual({ w: 0, l: 0, t: 1 });
    expect(records.get("buf")).toEqual({ w: 0, l: 0, t: 1 });
  });

  it("accumulates across weeks", () => {
    const records = recordsThroughWeek(
      [
        game(1, "kc", "buf", { home: 24, away: 17 }),
        game(2, "den", "kc", { home: 10, away: 31 }),
        game(3, "kc", "lv", { home: 3, away: 9 }),
      ],
      4,
    );
    expect(records.get("kc")).toEqual({ w: 2, l: 1, t: 0 });
  });

  it("ignores games that are not final", () => {
    // Scheduled, live and postponed games all carry no result yet — counting a
    // live game would have the badge flicker mid-broadcast.
    const records = recordsThroughWeek(
      [
        game(1, "kc", "buf"),
        game(1, "den", "lv", { home: 14, away: 7 }, { status: "in_progress" }),
        game(1, "sf", "sea", { home: 21, away: 3 }, { status: "postponed" }),
      ],
      2,
    );
    expect(records.size).toBe(0);
  });

  it("ignores a final with a missing score", () => {
    const records = recordsThroughWeek(
      [game(1, "kc", "buf", undefined, { status: "final" })],
      2,
    );
    expect(records.size).toBe(0);
  });

  it("counts only weeks strictly before the one on screen", () => {
    const games = [
      game(1, "kc", "buf", { home: 24, away: 17 }),
      game(2, "kc", "den", { home: 30, away: 10 }),
      game(3, "kc", "lv", { home: 28, away: 21 }),
    ];
    // Viewing week 3: weeks 1 and 2 are in, week 3 itself is not — the number
    // means "coming into this week" and must not move as the week plays out.
    expect(recordsThroughWeek(games, 3).get("kc")).toEqual({ w: 2, l: 0, t: 0 });
    expect(recordsThroughWeek(games, 1)).toEqual(new Map());
  });

  it("ignores preseason results even if handed the full schedule", () => {
    const records = recordsThroughWeek(
      [
        game(1, "kc", "buf", { home: 24, away: 17 }, { seasonType: "pre" }),
        game(1, "den", "lv", { home: 14, away: 7 }),
      ],
      2,
    );
    expect(records.get("kc")).toBeUndefined();
    expect(records.get("den")).toEqual({ w: 1, l: 0, t: 0 });
  });

  it("leaves a team that hasn't played out of the map entirely", () => {
    const records = recordsThroughWeek([game(1, "kc", "buf", { home: 24, away: 17 })], 2);
    expect(records.has("sea")).toBe(false);
  });
});

describe("formatRecord", () => {
  it("prints wins and losses", () => {
    expect(formatRecord({ w: 9, l: 4, t: 0 })).toBe("9-4");
  });

  it("adds ties only when there are some", () => {
    expect(formatRecord({ w: 9, l: 4, t: 1 })).toBe("9-4-1");
  });

  it("prints 0-0 for a team with no record yet", () => {
    // The live case until the scorer marks a regular-season game final.
    expect(formatRecord(undefined)).toBe("0-0");
    expect(formatRecord(emptyRecord())).toBe("0-0");
  });
});

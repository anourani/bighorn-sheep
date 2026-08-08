import { describe, expect, it } from "vitest";
import { buildGameIndex } from "./games";
import { TEAM_COUNT } from "../nfl/teams";
import type { Game, SeasonType } from "../nfl/types";

function game(overrides: Partial<Game> & { id: string }): Game {
  return {
    season: 2026,
    seasonType: "regular",
    week: 1,
    kickoff: "2026-09-10T00:20:00.000Z",
    status: "scheduled",
    home: "kc",
    away: "phi",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

describe("buildGameIndex", () => {
  it("finds a team's game for a week, home or away", () => {
    const idx = buildGameIndex([game({ id: "a", week: 2, home: "sf", away: "dal" })]);
    expect(idx.gameForTeam(2, "sf")?.id).toBe("a");
    expect(idx.gameForTeam(2, "dal")?.id).toBe("a");
    expect(idx.gameForTeam(2, "kc")).toBeUndefined();
    expect(idx.gameForTeam(3, "sf")).toBeUndefined();
  });

  it("reports the last kickoff of a week as the deadline", () => {
    const idx = buildGameIndex([
      game({ id: "thu", week: 4, kickoff: "2026-10-01T00:20:00.000Z" }),
      game({ id: "mon", week: 4, kickoff: "2026-10-06T00:15:00.000Z", home: "sf", away: "dal" }),
    ]);
    expect(idx.weekFinalKickoff(4)?.toISOString()).toBe("2026-10-06T00:15:00.000Z");
    expect(idx.weekFinalKickoff(5)).toBeNull();
  });

  it("treats a week with no schedule as having no bye information", () => {
    const idx = buildGameIndex([]);
    expect(idx.byesForWeek(1)).toEqual([]);
    expect(idx.weeksWithGames).toEqual([]);
  });

  it("computes byes as every team not playing that week", () => {
    const idx = buildGameIndex([game({ id: "a", week: 1, home: "kc", away: "phi" })]);
    const byes = idx.byesForWeek(1);
    expect(byes).toHaveLength(TEAM_COUNT - 2);
    expect(byes).not.toContain("kc");
    expect(byes).not.toContain("phi");
  });

  it("lists weeks with games in ascending order", () => {
    const idx = buildGameIndex([
      game({ id: "c", week: 7 }),
      game({ id: "a", week: 2 }),
      game({ id: "b", week: 5 }),
    ]);
    expect(idx.weeksWithGames).toEqual([2, 5, 7]);
  });
});

describe("season_type slicing", () => {
  /*
   * buildGameIndex keys purely on week number — it has no notion of season type.
   * That is a deliberate simplification, and it is only safe because every caller
   * hands it a list already filtered to ONE season_type (load.ts runs two queries
   * and builds two indexes).
   *
   * These tests pin both sides of that contract: separate slices behave, and a
   * mixed list silently corrupts. The mixed case is what shipped before the
   * filters were added.
   */

  const preWeek1 = game({
    id: "pre-1",
    seasonType: "pre" as SeasonType,
    week: 1,
    home: "kc",
    away: "sf",
    kickoff: "2026-08-14T00:00:00.000Z",
  });
  const regularWeek1 = game({
    id: "reg-1",
    seasonType: "regular" as SeasonType,
    week: 1,
    home: "kc",
    away: "phi",
    kickoff: "2026-09-10T00:20:00.000Z",
  });

  it("resolves the right opponent when each phase gets its own index", () => {
    expect(buildGameIndex([preWeek1]).gameForTeam(1, "kc")?.away).toBe("sf");
    expect(buildGameIndex([regularWeek1]).gameForTeam(1, "kc")?.away).toBe("phi");
  });

  it("collapses preseason and regular week 1 into one bucket if mixed", () => {
    const mixed = buildGameIndex([preWeek1, regularWeek1]);

    // Only ONE week 1 exists as far as the index is concerned, and gameForTeam
    // returns whichever came first — so Kansas City's "week 1 opponent" is decided
    // by row order rather than by the season.
    expect(mixed.weeksWithGames).toEqual([1]);
    expect(mixed.gameForTeam(1, "kc")?.id).toBe("pre-1");
    expect(buildGameIndex([regularWeek1, preWeek1]).gameForTeam(1, "kc")?.id).toBe("reg-1");

    // And the preseason kickoff becomes the regular season's pick deadline.
    expect(mixed.weekFinalKickoff(1)?.toISOString()).toBe("2026-09-10T00:20:00.000Z");

    // Byes are wrong too: kc, sf and phi (3 distinct teams across the two games)
    // all read as playing in the same week 1.
    expect(mixed.byesForWeek(1)).toHaveLength(TEAM_COUNT - 3);
  });

  it("reports real byes on a preseason slate where teams sit out", () => {
    // Preseason: each team plays 3 of 4 weeks, so a week genuinely has teams idle.
    const idx = buildGameIndex([
      game({ id: "p1", seasonType: "pre", week: 2, home: "kc", away: "sf" }),
      game({ id: "p2", seasonType: "pre", week: 2, home: "phi", away: "dal" }),
    ]);
    const byes = idx.byesForWeek(2);
    expect(byes).toHaveLength(TEAM_COUNT - 4);
    for (const playing of ["kc", "sf", "phi", "dal"]) {
      expect(byes).not.toContain(playing);
    }
  });
});

import { describe, expect, it } from "vitest";
import { cellFor, scrollLeftForWeek } from "./standings-grid";
import type { Game, TeamId } from "../../lib/nfl/types";
import type { GroupRules, Member } from "../../lib/league/types";

const WEEK = 6;
const KICKED = "2025-10-12T17:00:00.000Z";
const LATER = "2025-10-12T20:00:00.000Z";
const NOW = new Date("2025-10-12T18:00:00.000Z");
const RULES: GroupRules = { eliminationType: "single", tieRule: "push" };

function game(over: Partial<Game> & Pick<Game, "home" | "away">): Game {
  return {
    id: `g_${over.home}_${over.away}`,
    season: 2025,
    seasonType: "regular",
    week: WEEK,
    kickoff: KICKED,
    homeScore: null,
    awayScore: null,
    status: "scheduled",
    ...over,
  };
}

const GAMES: Game[] = [
  game({ home: "kc", away: "buf", status: "final", homeScore: 24, awayScore: 17 }),
  game({ home: "sf", away: "sea", status: "in_progress", homeScore: 7, awayScore: 3 }),
  game({ home: "dal", away: "phi", kickoff: LATER }),
  game({ home: "gb", away: "chi", status: "final", homeScore: 20, awayScore: 20 }),
];

const gameForTeam = (week: number, teamId: TeamId): Game | undefined =>
  week === WEEK ? GAMES.find((g) => g.home === teamId || g.away === teamId) : undefined;

function member(over: Partial<Member> = {}): Member {
  return {
    id: "m1",
    name: "Ali B.",
    firstName: "Ali",
    lastName: "B",
    favoriteAnimal: null,
    phone: null,
    role: "player",
    status: "alive",
    strikes: 0,
    buyInPaid: false,
    buyInPaidAt: null,
    showPreseason: false,
    eliminatedWeek: null,
    history: [],
    currentPick: null,
    ...over,
  };
}

const cell = (m: Member, week: number, viewerId = "", hidden: string[] = []) =>
  cellFor(m, viewerId, week, WEEK, gameForTeam, RULES, NOW, new Set(hidden));

describe("cellFor — settled weeks", () => {
  it("keeps a loss tinted after its week has passed", () => {
    // The permanence is what lets the table be scrolled to read who went out
    // and when: a red tile is the week somebody took a strike.
    const m = member({ history: [{ week: 3, teamId: "buf", result: "loss" }] });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "buf", result: "loss" });
  });

  it("drops the tint from a settled win", () => {
    // Green on every survived week would be a wall of colour saying nothing.
    const m = member({ history: [{ week: 3, teamId: "kc", result: "win" }] });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "kc", result: undefined });
  });

  it("draws a settled push like a win — it survived", () => {
    const m = member({ history: [{ week: 3, teamId: "gb", result: "push" }] });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "gb", result: undefined });
  });

  it("is an empty slot for a week that went unpicked", () => {
    expect(cell(member(), 3)).toEqual({ kind: "empty" });
  });

  it("never consults the game index for a past week", () => {
    // The landing page ships games for the current week ALONE, so a lookup here
    // would return undefined there and blank every historical cell — while the
    // signed-in app, which holds the whole season, carried on looking correct.
    const m = member({ history: [{ week: 3, teamId: "kc", result: "win" }] });
    let asked = 0;
    cellFor(
      m,
      "",
      3,
      WEEK,
      (week, teamId) => {
        asked += 1;
        return gameForTeam(week, teamId);
      },
      RULES,
      NOW,
      new Set(),
    );
    expect(asked).toBe(0);
  });
});

describe("cellFor — the current week", () => {
  it("tints a win while its week is being played", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "kc", gameId: "g1" } });
    expect(cell(m, WEEK)).toEqual({ kind: "team", teamId: "kc", result: "win", live: false });
  });

  it("tints a loss", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "buf", gameId: "g1" } });
    expect(cell(m, WEEK)).toEqual({ kind: "team", teamId: "buf", result: "loss", live: false });
  });

  it("marks a game in progress as live and leaves it untinted", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "sf", gameId: "g2" } });
    expect(cell(m, WEEK)).toEqual({ kind: "team", teamId: "sf", result: undefined, live: true });
  });

  it("hides a rival's pick until that team's game kicks off", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "dal", gameId: "g3" } });
    expect(cell(m, WEEK)).toEqual({ kind: "hidden" });
  });

  it("shows the viewer their own un-kicked pick", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "dal", gameId: "g3" } });
    expect(cell(m, WEEK, "m1")).toEqual({
      kind: "team",
      teamId: "dal",
      result: undefined,
      live: false,
    });
  });

  it("draws a padlock from the team-less flag when RLS withheld the row", () => {
    // A rival's hidden pick returns no row at all, so `currentPick` is null and
    // the flag is the only thing separating "picked, hidden" from "not picked".
    expect(cell(member(), WEEK, "", ["m1"])).toEqual({ kind: "hidden" });
    expect(cell(member(), WEEK)).toEqual({ kind: "empty" });
  });
});

describe("cellFor — future weeks", () => {
  it("is an empty slot", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "kc", gameId: "g1" } });
    expect(cell(m, WEEK + 1)).toEqual({ kind: "empty" });
  });
});

describe("scrollLeftForWeek", () => {
  it("parks the column just clear of the sticky name column", () => {
    // Column 6 starts at 300px; scrolling 154 puts its left edge at the 146px
    // sticky boundary rather than under it.
    expect(scrollLeftForWeek(6, 146, 50)).toBe(154);
  });

  it("does not scroll while the live week is already past the sticky edge", () => {
    // Weeks 1-3 sit within the first 146px, so there is nothing to scroll away.
    expect(scrollLeftForWeek(0, 146, 50)).toBe(0);
    expect(scrollLeftForWeek(2, 146, 50)).toBe(0);
  });

  it("is 0 for a week that isn't on the table", () => {
    // `findIndex` answers -1 when the live week has no column — the practice
    // table previewing a regular season it holds no picks for.
    expect(scrollLeftForWeek(-1, 146, 50)).toBe(0);
  });
});

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
    userId: "u1",
    entryNo: 1,
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

  it("draws a MISSED tile for a week that went unpicked, not an empty slot", () => {
    // This was `empty` — the same hollow circle a week still to come draws — so
    // the single most consequential thing on the board, somebody going out by
    // not picking at all, was the one outcome it did not show.
    expect(cell(member(), 3)).toEqual({ kind: "missed" });
  });

  it("draws an unresolved past pick rather than treating it as missed", () => {
    // A postponed game, or a week the scorer has not reached. The pick is real,
    // so it keeps its logo and takes no tint — and `history` carries it as
    // "pending" precisely so it does not fall into the branch above and get a
    // red tile printed over a pick that was made.
    const m = member({ history: [{ week: 3, teamId: "dal", result: "pending" }] });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "dal", result: undefined });
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
    // "u1" — the USER id, not the membership id "m1". Since 0017 the viewer is
    // matched on `member.userId`, so that a two-entry player sees BOTH of their
    // own picks rather than only the row whose membership id happens to match.
    const m = member({ currentPick: { week: WEEK, teamId: "dal", gameId: "g3" } });
    expect(cell(m, WEEK, "u1")).toEqual({
      kind: "team",
      teamId: "dal",
      result: undefined,
      live: false,
    });
  });

  it("draws a padlock from the team-less flag when RLS withheld the row", () => {
    // A rival's hidden pick returns no row at all, so `currentPick` is null and
    // the flag is the only thing separating "picked, hidden" from "not picked".
    // The flag holds MEMBERSHIP ids ("m1"), which is what lets a padlock land on
    // one of a player's two entries and not the other.
    expect(cell(member(), WEEK, "", ["m1"])).toEqual({ kind: "hidden" });
    expect(cell(member(), WEEK)).toEqual({ kind: "empty" });
  });

  it("reveals both of a two-entry player's own picks", () => {
    // The two rows share a userId and differ by membership id. Revealing one
    // and padlocking the other would be hiding somebody's pick from themselves.
    const pick = { week: WEEK, teamId: "dal", gameId: "g3" } as const;
    const one = member({ id: "m1", userId: "u1", entryNo: 1, currentPick: pick });
    const two = member({ id: "m2", userId: "u1", entryNo: 2, currentPick: pick });
    expect(cell(one, WEEK, "u1")).toMatchObject({ kind: "team", teamId: "dal" });
    expect(cell(two, WEEK, "u1")).toMatchObject({ kind: "team", teamId: "dal" });
  });

  it("reveals nobody's pick to an empty viewer id", () => {
    /*
     * The landing board passes "" because a stranger is nobody, and
     * `rankMembers` passes "" so that no row is sorted on information the
     * others were not. The public payload also maps every row's `userId` to ""
     * — so without the empty-string guard in `viewCurrentPick` those two would
     * MATCH and the anonymous board would reveal every hidden pick in the
     * league. This is the regression that guard exists for.
     */
    const m = member({ userId: "", currentPick: { week: WEEK, teamId: "dal", gameId: "g3" } });
    expect(cell(m, WEEK, "")).toEqual({ kind: "hidden" });
  });
});

describe("cellFor — future weeks", () => {
  it("is an empty slot", () => {
    const m = member({ currentPick: { week: WEEK, teamId: "kc", gameId: "g1" } });
    expect(cell(m, WEEK + 1)).toEqual({ kind: "empty" });
  });
});

describe("cellFor — an eliminated row", () => {
  it("marks the week they went out by NOT picking, in the window before the week rolls", () => {
    /*
     * The whole reason the missed tile exists. `resolveCurrentWeek` holds the
     * current week until the next week's first kickoff, so somebody struck out
     * by Monday night reads as eliminated-at-the-current-week from then until
     * Thursday — and through all of that this cell drew a hollow circle
     * indistinguishable from a week nobody had got to yet.
     */
    const m = member({ status: "eliminated", eliminatedWeek: WEEK });
    expect(cell(m, WEEK)).toEqual({ kind: "missed" });
  });

  it("still padlocks rather than accusing, when the flag says they did pick", () => {
    // Eliminated this week WITH a locked hidden pick — they picked and lost, or
    // are about to. The padlock outranks the missed tile; claiming they never
    // picked would be false.
    const m = member({ status: "eliminated", eliminatedWeek: WEEK });
    expect(cell(m, WEEK, "", ["m1"])).toEqual({ kind: "hidden" });
  });

  it("blanks a week AFTER the one they went out in, even with a pick on file", () => {
    /*
     * Elimination deletes nothing: picks made ahead stay in the database and
     * resolve happily, so a dead row kept drawing logos and tints for weeks the
     * member was no longer playing. The scorer agrees — `computeStatus` stops
     * folding at elimination — so those weeks are not counted against them
     * either, and the board should not imply they were played.
     */
    const m = member({
      status: "eliminated",
      eliminatedWeek: 3,
      history: [
        { week: 3, teamId: "buf", result: "loss" },
        { week: 4, teamId: "kc", result: "win" },
      ],
    });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "buf", result: "loss" });
    expect(cell(m, 4)).toEqual({ kind: "empty" });
    expect(cell(m, 5)).toEqual({ kind: "empty" });
  });

  it("draws its history when no elimination week was recorded", () => {
    // `eliminatedWeek` is optional on `Member`. A row marked out with no week
    // on it must fall through, not blank the entire season.
    const m = member({
      status: "eliminated",
      eliminatedWeek: null,
      history: [{ week: 3, teamId: "buf", result: "loss" }],
    });
    expect(cell(m, 3)).toEqual({ kind: "team", teamId: "buf", result: "loss" });
  });
});

describe("cellFor — scoredFromWeek", () => {
  it("counts every past week when it is absent, which is the regular season's rule", () => {
    // `recomputeSeason` folds from week 1 with no clamp, and joining closes
    // during Week 1, so there is no regular-season week a member was not there
    // for. Both real boards leave the field unset.
    expect(member().scoredFromWeek).toBeUndefined();
    expect(cell(member(), 3)).toEqual({ kind: "missed" });
  });

  it("forgives a week before the record begins — the practice table's clamp", () => {
    // Preseason has no entry deadline, so its weeks before a member's first
    // pick are skipped rather than forgiven. Without this the practice board
    // would print "counted as a loss" over the Hall of Fame game in early
    // August for an account that did not exist yet.
    const m = member({ scoredFromWeek: 3, history: [{ week: 3, teamId: "kc", result: "win" }] });
    expect(cell(m, 1)).toEqual({ kind: "empty" });
    expect(cell(m, 2)).toEqual({ kind: "empty" });
    expect(cell(m, 4)).toEqual({ kind: "missed" });
  });

  it("counts nothing for a null record start — somebody who never played", () => {
    const m = member({ scoredFromWeek: null });
    expect(cell(m, 1)).toEqual({ kind: "empty" });
    expect(cell(m, 3)).toEqual({ kind: "empty" });
    expect(cell(m, WEEK)).toEqual({ kind: "empty" });
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

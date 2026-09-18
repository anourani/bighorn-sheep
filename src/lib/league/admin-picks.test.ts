import { describe, expect, it } from "vitest";
import {
  buildAdminPickData,
  canAdminEditPick,
  startedWeeks,
  teamsPlayingInWeek,
  usedTeamsForEntry,
  viewPickForWeek,
  type AdminPickGame,
} from "./admin-picks";
import { resolveCurrentWeek } from "../game/season";
import type { Member } from "./types";

/**
 * The Picks tab's rules, pinned where they can be tested — there is no jsdom
 * here, so the component itself is only reachable by source-text guards.
 */

const ISO = (d: string) => new Date(d).toISOString();

/** One game. Weeks run Thursday-to-Monday, as the real schedule does. */
const game = (week: number, kickoff: string, home: string, away: string): AdminPickGame => ({
  week,
  kickoff: ISO(kickoff),
  home,
  away,
});

/** A week of two games, the first on Thursday and the second on Sunday. */
const weekOf = (week: number, thursday: string, sunday: string): AdminPickGame[] => [
  game(week, thursday, "kc", "bal"),
  game(week, sunday, "sf", "lar"),
];

const member = (over: Partial<Member> & Pick<Member, "id">): Member => ({
  userId: "u1",
  entryNo: 1,
  name: "Alex N.",
  firstName: "Alex",
  lastName: "Nourani",
  favoriteAnimal: null,
  phone: null,
  role: "player",
  status: "alive",
  strikes: 0,
  buyInPaid: false,
  buyInPaidAt: null,
  showPreseason: false,
  history: [],
  currentPick: null,
  ...over,
});

describe("startedWeeks", () => {
  it("takes the week's EARLIEST kickoff, so a week is open from its Thursday", () => {
    const games = [...weekOf(1, "2026-09-10T00:20Z", "2026-09-13T17:00Z")];
    // Saturday: Thursday's game has been and gone, Sunday's has not.
    expect(startedWeeks(games, new Date(ISO("2026-09-12T12:00Z")))).toEqual([1]);
  });

  it("excludes a week whose first kickoff is still ahead", () => {
    const games = [...weekOf(1, "2026-09-10T00:20Z", "2026-09-13T17:00Z"), ...weekOf(2, "2026-09-17T00:20Z", "2026-09-20T17:00Z")];
    expect(startedWeeks(games, new Date(ISO("2026-09-14T12:00Z")))).toEqual([1]);
  });

  /*
   * THE REGRESSION THIS FILE EXISTS FOR. Every other week derivation in the app
   * goes through `resolveCurrentWeek`, which answers 1 during the preseason so
   * the pick screen has a week to draw. A `1..currentWeek` range would therefore
   * offer Week 1 as editable all summer — months before a ball is thrown, and
   * while every player can still legitimately change their own Week 1 pick.
   * Asserted side by side so the difference is the test rather than a comment.
   */
  it("answers [] in the preseason, where resolveCurrentWeek answers 1", () => {
    const games = [...weekOf(1, "2026-09-10T00:20Z", "2026-09-13T17:00Z")];
    const august = new Date(ISO("2026-08-20T12:00Z"));

    expect(resolveCurrentWeek({ phase: "preseason", now: august, games })).toBe(1);
    expect(startedWeeks(games, august)).toEqual([]);
  });

  it("is ascending and deduped however the games arrive", () => {
    const games = [
      game(3, "2026-09-24T00:20Z", "kc", "bal"),
      game(1, "2026-09-10T00:20Z", "sf", "lar"),
      game(3, "2026-09-27T17:00Z", "gb", "chi"),
      game(2, "2026-09-17T00:20Z", "buf", "nyj"),
    ];
    expect(startedWeeks(games, new Date(ISO("2026-10-01T00:00Z")))).toEqual([1, 2, 3]);
  });

  it("keeps a week open when one of its games is postponed into the future", () => {
    // A postponed game keeps its week and gains a later kickoff. `min` is
    // already in the past, so the week cannot be pulled back out of the list.
    const games = [
      game(5, "2026-10-08T00:20Z", "kc", "bal"),
      game(5, "2026-12-20T17:00Z", "sf", "lar"),
    ];
    expect(startedWeeks(games, new Date(ISO("2026-10-10T00:00Z")))).toEqual([5]);
  });

  it("tolerates an empty schedule rather than throwing", () => {
    expect(startedWeeks([], new Date())).toEqual([]);
  });
});

describe("teamsPlayingInWeek", () => {
  it("returns both sides of every game in that week, and nothing from another", () => {
    const games = [...weekOf(1, "2026-09-10T00:20Z", "2026-09-13T17:00Z"), game(2, "2026-09-17T00:20Z", "gb", "chi")];
    expect(teamsPlayingInWeek(games, 1)).toEqual(["bal", "kc", "lar", "sf"]);
  });

  it("omits a team on a bye, which is what stops the UI offering no_game_for_team", () => {
    const games = [game(6, "2026-10-15T00:20Z", "kc", "bal")];
    expect(teamsPlayingInWeek(games, 6)).not.toContain("sf");
  });

  it("sorts, so the option order cannot reshuffle under the cursor", () => {
    const shuffled = [game(1, "2026-09-10T00:20Z", "sf", "bal"), game(1, "2026-09-13T17:00Z", "kc", "ari")];
    expect(teamsPlayingInWeek(shuffled, 1)).toEqual(["ari", "bal", "kc", "sf"]);
  });
});

describe("buildAdminPickData", () => {
  it("carries teams for started weeks only", () => {
    const games = [...weekOf(1, "2026-09-10T00:20Z", "2026-09-13T17:00Z"), ...weekOf(2, "2026-09-17T00:20Z", "2026-09-20T17:00Z")];
    const data = buildAdminPickData({
      games,
      now: new Date(ISO("2026-09-14T12:00Z")),
      currentWeek: 1,
      hiddenPickMemberIds: ["m9"],
    });

    expect(data.startedWeeks).toEqual([1]);
    expect(Object.keys(data.teamsByWeek)).toEqual(["1"]);
    expect(data.teamsByWeek[2]).toBeUndefined();
    expect(data.hiddenPickMemberIds).toEqual(["m9"]);
  });

  it("copies the hidden list rather than aliasing the caller's array", () => {
    const hidden = ["m1"];
    const data = buildAdminPickData({ games: [], now: new Date(), currentWeek: 1, hiddenPickMemberIds: hidden });
    hidden.push("m2");
    expect(data.hiddenPickMemberIds).toEqual(["m1"]);
  });
});

describe("viewPickForWeek", () => {
  const hiddenMemberIds = ["m-hidden"];

  it("reads history for a past week, carrying its result", () => {
    const m = member({ id: "m1", history: [{ week: 3, teamId: "kc", result: "loss" }] });
    expect(viewPickForWeek({ member: m, week: 3, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "team",
      teamId: "kc",
      result: "loss",
    });
  });

  it("reads currentPick for the live week", () => {
    const m = member({ id: "m1", currentPick: { week: 6, teamId: "sf", gameId: "g6" } });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "team",
      teamId: "sf",
      result: null,
    });
  });

  /*
   * THE OVERWRITE-BLIND REGRESSION. RLS hands back another member's pick only
   * once its game has kicked off, so in the live week somebody who picked a 4pm
   * game arrives with `currentPick: null` — identical to somebody who has not
   * picked at all. Rendering both as "No pick" invites an admin to overwrite a
   * real pick they cannot see, which is not a correction.
   */
  it("is `hidden`, never `none`, for a live-week member whose game has not kicked off", () => {
    const m = member({ id: "m-hidden", currentPick: null });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "hidden",
    });
  });

  it("prefers a revealed pick over the hidden flag — the row is the newer fact", () => {
    // A membership id can sit in both sets across a kickoff: the hidden list is
    // a snapshot taken at load, `currentPick` is the row itself.
    const m = member({ id: "m-hidden", currentPick: { week: 6, teamId: "gb", gameId: "g6" } });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "team",
      teamId: "gb",
      result: null,
    });
  });

  it("is `none` for a member who genuinely has not picked the live week", () => {
    const m = member({ id: "m-nopick", currentPick: null });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "none",
    });
  });

  /*
   * AN ELIMINATED ENTRY'S LATER WEEKS ARE ITS OWN. It keeps picking after it
   * goes out, and 0020 hides those rows from every other reader — the admin
   * included — so without this branch the row would read "No pick" over a
   * pick that exists and invite the same blind overwrite `hidden` prevents.
   */
  it("is `out` for a week after the entry was eliminated, whatever else it holds", () => {
    const m = member({
      id: "m-dead",
      status: "eliminated",
      eliminatedWeek: 3,
      history: [{ week: 5, teamId: "kc", result: "win" }],
      currentPick: { week: 6, teamId: "sf", gameId: "g6" },
    });
    expect(viewPickForWeek({ member: m, week: 5, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "out",
      eliminatedWeek: 3,
    });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "out",
      eliminatedWeek: 3,
    });
  });

  it("wins over the hidden flag in the live week — a dead entry never gets a padlock", () => {
    const m = member({ id: "m-hidden", status: "eliminated", eliminatedWeek: 2, currentPick: null });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds }).kind).toBe("out");
  });

  it("still shows the elimination week itself and everything before it", () => {
    // Correcting the losing pick is the repair this tab exists for.
    const m = member({
      id: "m-dead",
      status: "eliminated",
      eliminatedWeek: 3,
      history: [
        { week: 2, teamId: "gb", result: "win" },
        { week: 3, teamId: "kc", result: "loss" },
      ],
    });
    expect(viewPickForWeek({ member: m, week: 3, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "team",
      teamId: "kc",
      result: "loss",
    });
    expect(viewPickForWeek({ member: m, week: 2, currentWeek: 6, hiddenMemberIds }).kind).toBe("team");
  });

  it("ignores a currentPick belonging to a different week", () => {
    // Defensive: `toMember` only ever sets currentPick for `currentWeek`, but a
    // stale prop must not paint week 6's team into week 5's row.
    const m = member({ id: "m1", currentPick: { week: 5, teamId: "sf", gameId: "g5" } });
    expect(viewPickForWeek({ member: m, week: 6, currentWeek: 6, hiddenMemberIds })).toEqual({
      kind: "none",
    });
  });
});

describe("usedTeamsForEntry", () => {
  it("leaves the edited week's own team selectable — re-picking it is a no-op", () => {
    const m = member({
      id: "m1",
      history: [
        { week: 1, teamId: "kc", result: "win" },
        { week: 2, teamId: "sf", result: "win" },
      ],
    });
    expect(usedTeamsForEntry(m, 2)).toEqual(["kc"]);
  });

  it("counts the live week's pick when a PAST week is being edited", () => {
    const m = member({
      id: "m1",
      history: [{ week: 1, teamId: "kc", result: "win" }],
      currentPick: { week: 6, teamId: "sf", gameId: "g6" },
    });
    expect(usedTeamsForEntry(m, 1).sort()).toEqual(["sf"]);
  });

  /*
   * One person's two entries spend teams INDEPENDENTLY, and
   * picks_team_once_per_phase is keyed on (group, user, entry_no, season_type,
   * team). Folding on the person would grey out entry 2's options because entry
   * 1 had used them — the same conflation that produced 0017's wrong
   * eliminations. This takes ONE member, i.e. one entry, by construction.
   */
  it("answers per ENTRY, because a Member IS an entry", () => {
    const entry1 = member({ id: "m1", entryNo: 1, history: [{ week: 1, teamId: "kc", result: "win" }] });
    const entry2 = member({ id: "m2", entryNo: 2, history: [{ week: 1, teamId: "sf", result: "win" }] });

    expect(usedTeamsForEntry(entry1, 4)).toEqual(["kc"]);
    expect(usedTeamsForEntry(entry2, 4)).toEqual(["sf"]);
  });
});

describe("canAdminEditPick", () => {
  it("refuses a hidden pick even in a started week — the UI is stricter than the RPC", () => {
    expect(canAdminEditPick({ kind: "hidden" }, 6, [1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it("refuses a week after the entry was eliminated, started or not", () => {
    expect(canAdminEditPick({ kind: "out", eliminatedWeek: 3 }, 5, [1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it("refuses a week that has not started", () => {
    expect(canAdminEditPick({ kind: "none" }, 7, [1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it("allows a started week with no pick — creating one is the useful case", () => {
    expect(canAdminEditPick({ kind: "none" }, 3, [1, 2, 3])).toBe(true);
  });

  it("allows a started week with a revealed pick", () => {
    expect(canAdminEditPick({ kind: "team", teamId: "kc", result: "loss" }, 3, [1, 2, 3])).toBe(true);
  });
});

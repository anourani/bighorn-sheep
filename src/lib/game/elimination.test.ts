import { describe, expect, it } from "vitest";
import type { Game, GameStatus, TeamId } from "../nfl/types";
import type { GroupRules } from "../league/types";
import {
  canPick,
  computeStatus,
  evaluateTeamPick,
  evaluateWeek,
  seasonState,
} from "./elimination";

function game(overrides: Partial<Game> & { home: TeamId; away: TeamId }): Game {
  return {
    id: "g1",
    season: 2025,
    seasonType: "regular",
    week: 1,
    kickoff: "2025-09-07T17:00:00.000Z",
    status: "final" as GameStatus,
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

const single: GroupRules = { eliminationType: "single", tieRule: "push" };
const twoTime: GroupRules = { eliminationType: "two_time", tieRule: "push" };
const tieIsLoss: GroupRules = { eliminationType: "single", tieRule: "loss" };

describe("evaluateTeamPick", () => {
  it("marks a win when the picked team wins", () => {
    const g = game({ home: "kc", away: "buf", status: "final", homeScore: 24, awayScore: 17 });
    expect(evaluateTeamPick(g, "kc", single)).toBe("win");
  });

  it("marks a loss when the picked team loses", () => {
    const g = game({ home: "kc", away: "buf", status: "final", homeScore: 24, awayScore: 17 });
    expect(evaluateTeamPick(g, "buf", single)).toBe("loss");
  });

  it("is pending until the game is final", () => {
    const g = game({ home: "kc", away: "buf", status: "in_progress", homeScore: 3, awayScore: 0 });
    expect(evaluateTeamPick(g, "kc", single)).toBe("pending");
  });

  it("treats a tie as a push under the push rule", () => {
    const g = game({ home: "kc", away: "buf", status: "final", homeScore: 20, awayScore: 20 });
    expect(evaluateTeamPick(g, "kc", single)).toBe("push");
  });

  it("treats a tie as a loss under the loss rule", () => {
    const g = game({ home: "kc", away: "buf", status: "final", homeScore: 20, awayScore: 20 });
    expect(evaluateTeamPick(g, "kc", tieIsLoss)).toBe("loss");
  });
});

describe("evaluateWeek (missed pick)", () => {
  const weekFinalKickoff = new Date("2025-09-08T20:15:00.000Z"); // Monday night

  it("is no_pick before the final kickoff", () => {
    expect(
      evaluateWeek({
        teamId: null,
        game: null,
        weekFinalKickoff,
        rules: single,
        now: new Date("2025-09-07T12:00:00.000Z"),
      }),
    ).toBe("no_pick");
  });

  it("becomes a loss once the final kickoff passes with no pick", () => {
    expect(
      evaluateWeek({
        teamId: null,
        game: null,
        weekFinalKickoff,
        rules: single,
        now: new Date("2025-09-08T20:15:00.000Z"),
      }),
    ).toBe("loss");
  });

  it("evaluates a real pick normally", () => {
    const g = game({ home: "kc", away: "buf", status: "final", homeScore: 10, awayScore: 31 });
    expect(
      evaluateWeek({
        teamId: "kc",
        game: g,
        weekFinalKickoff,
        rules: single,
        now: new Date("2025-09-09T00:00:00.000Z"),
      }),
    ).toBe("loss");
  });
});

describe("computeStatus", () => {
  it("single-elimination: one loss ends the season at that week", () => {
    const r = computeStatus(single, ["win", "loss", "win"], [1, 2, 3]);
    expect(r).toEqual({ status: "eliminated", strikes: 1, eliminatedWeek: 2 });
  });

  it("single-elimination: pushes and wins keep a player alive", () => {
    const r = computeStatus(single, ["win", "push", "win"], [1, 2, 3]);
    expect(r).toEqual({ status: "alive", strikes: 0, eliminatedWeek: null });
  });

  it("two-time: first loss is a strike, still alive", () => {
    const r = computeStatus(twoTime, ["win", "loss", "win"], [1, 2, 3]);
    expect(r).toEqual({ status: "alive", strikes: 1, eliminatedWeek: null });
  });

  it("two-time: second loss eliminates at the later week", () => {
    const r = computeStatus(twoTime, ["loss", "win", "loss"], [1, 2, 3]);
    expect(r).toEqual({ status: "eliminated", strikes: 2, eliminatedWeek: 3 });
  });

  it("two-time: a push never adds a strike", () => {
    const r = computeStatus(twoTime, ["push", "push", "push"], [1, 2, 3]);
    expect(r.strikes).toBe(0);
    expect(r.status).toBe("alive");
  });

  it("ignores pending/no_pick weeks (not yet damaging)", () => {
    const r = computeStatus(single, ["win", "pending", "no_pick"], [1, 2, 3]);
    expect(r.status).toBe("alive");
  });
});

describe("canPick", () => {
  const base = {
    member: { status: "alive" as const, history: [{ teamId: "phi" }], currentPick: null },
    entryOpen: true,
    now: new Date("2025-09-07T12:00:00.000Z"),
  };
  const scheduled = { status: "scheduled" as GameStatus, kickoff: "2025-09-07T17:00:00.000Z" };

  it("allows a fresh team before kickoff", () => {
    expect(canPick({ ...base, teamId: "kc", game: scheduled })).toEqual({ ok: true });
  });

  it("rejects a team already used this season", () => {
    expect(canPick({ ...base, teamId: "phi", game: scheduled })).toEqual({
      ok: false,
      reason: "team_already_used",
    });
  });

  it("rejects once the team's game has kicked off", () => {
    expect(
      canPick({ ...base, teamId: "kc", game: { status: "in_progress", kickoff: scheduled.kickoff } }),
    ).toEqual({ ok: false, reason: "game_kicked_off" });
  });

  it("rejects a scheduled game whose kickoff time has already passed (stale feed)", () => {
    expect(
      canPick({
        ...base,
        teamId: "kc",
        game: scheduled,
        now: new Date("2025-09-07T17:30:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "game_kicked_off" });
  });

  it("rejects an eliminated member", () => {
    expect(
      canPick({ ...base, member: { ...base.member, status: "eliminated" }, teamId: "kc", game: scheduled }),
    ).toEqual({ ok: false, reason: "eliminated" });
  });

  it("rejects when entry has closed", () => {
    expect(canPick({ ...base, entryOpen: false, teamId: "kc", game: scheduled })).toEqual({
      ok: false,
      reason: "entry_closed",
    });
  });

  it("rejects a team on bye (no game this week)", () => {
    expect(canPick({ ...base, teamId: "kc", game: null })).toEqual({
      ok: false,
      reason: "no_game_for_team",
    });
  });
});

describe("seasonState", () => {
  it("declares a winner when one player remains", () => {
    const s = seasonState(
      [
        { id: "a", status: "eliminated" },
        { id: "b", status: "alive" },
      ],
      { currentWeek: 6 },
    );
    expect(s).toEqual({ kind: "winner", memberId: "b" });
  });

  it("flags a wipeout when nobody is left", () => {
    const s = seasonState(
      [
        { id: "a", status: "eliminated" },
        { id: "b", status: "eliminated" },
      ],
      { currentWeek: 6, wipeoutWeek: 6 },
    );
    expect(s).toEqual({ kind: "wipeout", week: 6 });
  });

  it("flags multiple survivors at the end of Week 18", () => {
    const s = seasonState(
      [
        { id: "a", status: "alive" },
        { id: "b", status: "alive" },
      ],
      { currentWeek: 18 },
    );
    expect(s).toEqual({ kind: "multi_survivor", memberIds: ["a", "b"] });
  });

  it("is in progress with multiple survivors before Week 18", () => {
    const s = seasonState(
      [
        { id: "a", status: "alive" },
        { id: "b", status: "alive" },
      ],
      { currentWeek: 6 },
    );
    expect(s).toEqual({ kind: "in_progress" });
  });
});

describe("the preseason practice reset", () => {
  /*
   * Preseason is played for real, but nothing survives into Week 1: strikes clear,
   * eliminated players come back, and every team is available again.
   *
   * The engine needs no special case for this, because it is a pure fold over
   * whatever results it is handed. The reset lives in WHICH results reach it:
   * recomputeSeason filters picks and games to season_type = 'regular', so no
   * preseason result is ever folded into a member's real standing. These pin that
   * the same engine gives both answers.
   */

  it("folds a preseason wipeout and a clean regular season independently", () => {
    const preseasonResults = computeStatus(single, ["loss", "loss"], [1, 2]);
    expect(preseasonResults).toEqual({ status: "eliminated", strikes: 1, eliminatedWeek: 1 });

    // The regular-season fold sees only regular-season results — an empty slate at
    // Week 1, whatever happened in August.
    const regular = computeStatus(single, [], []);
    expect(regular).toEqual({ status: "alive", strikes: 0, eliminatedWeek: null });
  });

  it("lets a team lost in preseason be picked again in the regular season", () => {
    // The regular-season guard is handed regular-season history only, so a team
    // spent in preseason simply isn't in the used list.
    const guard = canPick({
      member: { status: "alive", history: [] },
      teamId: "kc",
      game: game({ home: "kc", away: "phi", status: "scheduled", kickoff: "2026-09-13T17:00:00.000Z" }),
      entryOpen: true,
      now: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(guard).toEqual({ ok: true });

    // Whereas within one phase, a used team stays used.
    const samePhase = canPick({
      member: { status: "alive", history: [{ teamId: "kc" }] },
      teamId: "kc",
      game: game({ home: "kc", away: "phi", status: "scheduled", kickoff: "2026-09-13T17:00:00.000Z" }),
      entryOpen: true,
      now: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(samePhase).toEqual({ ok: false, reason: "team_already_used" });
  });
});

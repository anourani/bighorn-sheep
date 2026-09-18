import { describe, expect, it } from "vitest";
import type { Game, GameStatus, TeamId } from "../nfl/types";
import type { GroupRules } from "../league/types";
import {
  canPick,
  computeStatus,
  isExistingPickLocked,
  countStrikes,
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
    member: { history: [{ teamId: "phi" }] },
    // No pick for the target week yet — the ordinary first-pick case, and the
    // shape every assertion below inherits unless it says otherwise.
    existingPick: null,
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

  it("has no status test — an eliminated entry picks on the same terms", () => {
    // The guard used to refuse `reason: "eliminated"` ahead of everything. An
    // eliminated entry now keeps picking, privately: the weeks after it went
    // out are hidden from everyone else by 0020's SQL and
    // `lib/league/post-elimination.ts`, not by a refusal here. The input shape
    // no longer carries a status at all, so a call site cannot re-add the test
    // by accident.
    const member = { history: [{ teamId: "phi" }] };
    expect(canPick({ ...base, member, teamId: "kc", game: scheduled })).toEqual({ ok: true });
    expect("status" in member).toBe(false);
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

  /*
   * THE FROZEN WEEK. Once this entry's pick for the target week has kicked off
   * the member is committed, and no team in that week may be written — not the
   * thirteen Sunday fixtures that have not played, and not the one they took.
   *
   * The bug: the guard tested only the TARGET team's game, so a Thursday-night
   * pick locked while every other card stayed live. RLS refused those writes all
   * along and reported no error (a failing `using` clause filters an UPDATE
   * rather than raising), so the screen said the pick had saved.
   */
  const started = { status: "in_progress" as GameStatus, kickoff: scheduled.kickoff };

  it("refuses to move a pick whose own game has kicked off", () => {
    // The whole bug in one assertion: "kc" is free, its Sunday game is hours
    // away, and the answer is still no.
    expect(
      canPick({ ...base, teamId: "kc", game: scheduled, existingPick: { game: started } }),
    ).toEqual({ ok: false, reason: "pick_locked" });
  });

  it("still allows changing a pick that has NOT kicked off", () => {
    // The regression to watch for. Changing an un-started pick is most of what
    // the screen is for, and closing this would break picking ahead outright.
    expect(
      canPick({ ...base, teamId: "kc", game: scheduled, existingPick: { game: scheduled } }),
    ).toEqual({ ok: true });
  });

  it("leaves the week open for a member who has not picked in it", () => {
    // The case the freeze must not over-reach into: a game elsewhere in the week
    // has started, but you are committed to nothing, so the slate is still yours.
    // `existingPick` is about YOUR pick, never "has any game this week started".
    expect(canPick({ ...base, teamId: "kc", game: scheduled, existingPick: null })).toEqual({
      ok: true,
    });
  });

  it("treats a pick whose fixture is missing as locked", () => {
    // Fail CLOSED. A wrongly-frozen week costs an explained refusal; a wrongly
    // open one rewrites a game record already in play.
    expect(
      canPick({ ...base, teamId: "kc", game: scheduled, existingPick: { game: null } }),
    ).toEqual({ ok: false, reason: "pick_locked" });
  });

  it("reports pick_locked ahead of every team-level reason", () => {
    // Precedence is the copy's problem, not the outcome's: when the week is
    // frozen, "you've already used that team" / "that team isn't playing" /
    // "that game has kicked off" all invite the player to go and try a
    // different card, and every other card will fail identically.
    const frozen = { ...base, existingPick: { game: started } };
    expect(canPick({ ...frozen, teamId: "phi", game: scheduled }).ok).toBe(false);
    expect(canPick({ ...frozen, teamId: "phi", game: scheduled })).toEqual({
      ok: false,
      reason: "pick_locked",
    });
    expect(canPick({ ...frozen, teamId: "kc", game: null })).toEqual({
      ok: false,
      reason: "pick_locked",
    });
    expect(canPick({ ...frozen, teamId: "kc", game: started })).toEqual({
      ok: false,
      reason: "pick_locked",
    });
  });

  it("still locks a kicked-off week for an eliminated entry", () => {
    // Elimination no longer closes anything, but the lock still does: a
    // knocked-out entry's committed pick is as frozen as anyone else's.
    expect(
      canPick({
        ...base,
        teamId: "kc",
        game: scheduled,
        existingPick: { game: started },
      }),
    ).toEqual({ ok: false, reason: "pick_locked" });
  });
});

describe("isExistingPickLocked", () => {
  const now = new Date("2025-09-07T12:00:00.000Z");
  const future = { status: "scheduled" as GameStatus, kickoff: "2025-09-07T17:00:00.000Z" };

  it("says no when there is no pick at all", () => {
    // A Thursday kickoff does not close a week you never picked.
    expect(isExistingPickLocked(null, now)).toBe(false);
  });

  it("says no while the pick's game is still ahead", () => {
    expect(isExistingPickLocked({ game: future }, now)).toBe(false);
  });

  it("says yes once the game is under way", () => {
    expect(isExistingPickLocked({ game: { ...future, status: "in_progress" } }, now)).toBe(true);
  });

  it("says yes on a stale feed whose kickoff has simply passed", () => {
    // `isKickedOff`'s own guard: still "scheduled", but the clock says otherwise.
    expect(isExistingPickLocked({ game: future }, new Date("2025-09-07T17:30:00.000Z"))).toBe(true);
  });

  it("says yes when the pick's fixture is missing — fail closed", () => {
    expect(isExistingPickLocked({ game: null }, now)).toBe(true);
  });

  it("calls a POSTPONED game with a future kickoff OPEN, which RLS does not", () => {
    // Deliberate, and the reason `submitPick`'s zero-row check is not a
    // redundant backstop for this function. RLS gates on `status = 'scheduled'`,
    // so it refuses this row while `isKickedOff` lets it through — the one case
    // the guard structurally cannot see, caught at the write instead.
    expect(isExistingPickLocked({ game: { ...future, status: "postponed" } }, now)).toBe(false);
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

describe("countStrikes", () => {
  /*
   * The practice round's counter. It exists because `computeStatus` cannot answer
   * this question: that fold `break`s as soon as it eliminates someone, so it stops
   * counting at the allowance. Preseason eliminates nobody and therefore has no
   * allowance to stop at — see `src/lib/league/practice.ts`.
   */

  it("counts every damaging week, with no allowance to stop at", () => {
    expect(countStrikes(["loss", "loss", "loss"])).toBe(3);

    // The same three results through the regular season's fold report ONE strike,
    // because the run ended at the first. Both answers are right for their own
    // question; reusing this one for practice is what printed a capped, plausible,
    // wrong number.
    expect(computeStatus(single, ["loss", "loss", "loss"], [1, 2, 3]).strikes).toBe(1);
  });

  it("ignores wins, pushes and unplayed weeks", () => {
    expect(countStrikes(["win", "push", "no_pick", "pending"])).toBe(0);
    expect(countStrikes([])).toBe(0);
  });
});

describe("preseason results never reach the regular-season fold", () => {
  /*
   * Nothing survives into Week 1: strikes clear, used teams free up, and preseason
   * leaves the standings.
   *
   * The engine needs no special case for this, because it is a pure fold over
   * whatever results it is handed. The reset lives in WHICH results reach it:
   * recomputeSeason filters picks and games to season_type = 'regular', so no
   * preseason result is ever folded into a member's real standing.
   */

  it("starts the regular season from an empty slate whatever happened in August", () => {
    const regular = computeStatus(single, [], []);
    expect(regular).toEqual({ status: "alive", strikes: 0, eliminatedWeek: null });
  });

  it("lets a team lost in preseason be picked again in the regular season", () => {
    // The regular-season guard is handed regular-season history only, so a team
    // spent in preseason simply isn't in the used list.
    const guard = canPick({
      member: { history: [] },
      teamId: "kc",
      game: game({ home: "kc", away: "phi", status: "scheduled", kickoff: "2026-09-13T17:00:00.000Z" }),
      existingPick: null,
      entryOpen: true,
      now: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(guard).toEqual({ ok: true });

    // Whereas within one phase, a used team stays used.
    const samePhase = canPick({
      member: { history: [{ teamId: "kc" }] },
      teamId: "kc",
      game: game({ home: "kc", away: "phi", status: "scheduled", kickoff: "2026-09-13T17:00:00.000Z" }),
      existingPick: null,
      entryOpen: true,
      now: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(samePhase).toEqual({ ok: false, reason: "team_already_used" });
  });
});

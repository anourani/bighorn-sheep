import { describe, expect, it } from "vitest";
import { mapPublicSnapshot } from "./public";

/**
 * These cover the mapper, not the privacy lock. The lock lives in SQL
 * (0009_public_standings.sql) and cannot be tested from here — by the time a
 * payload reaches this function the hidden picks are already gone. What is
 * testable here is that the mapper doesn't *undo* the lock's intent: that the
 * padlock set is narrowed to the current week, and that nothing invents a pick.
 */

const NOW = "2025-10-12T17:30:00Z";
const ENTRY_CLOSES = "2025-09-05T00:20:00Z"; // Week 1 kickoff, already passed

function game(part: {
  id: string;
  week: number;
  kickoff: string;
  status?: string;
  home?: string;
  away?: string;
  home_score?: number | null;
  away_score?: number | null;
}) {
  return {
    id: part.id,
    season: 2025,
    season_type: "regular",
    week: part.week,
    kickoff: part.kickoff,
    status: part.status ?? "final",
    home: part.home ?? "nyg",
    away: part.away ?? "phi",
    home_score: part.home_score ?? null,
    away_score: part.away_score ?? null,
    status_detail: null,
  };
}

/** Week 6 is "current": its first kickoff has passed at NOW, Week 7's has not. */
const GAMES = [
  game({ id: "g1", week: 1, kickoff: "2025-09-05T00:20:00Z", home_score: 24, away_score: 20 }),
  game({ id: "g6", week: 6, kickoff: "2025-10-12T17:00:00Z", status: "in_progress" }),
  game({ id: "g7", week: 7, kickoff: "2025-10-19T17:00:00Z", status: "scheduled" }),
];

function snapshot(over: Record<string, unknown> = {}) {
  return {
    now: NOW,
    group: {
      name: "Sheep with Glasses",
      season: 2025,
      elimination_type: "single",
      tie_rule: "push",
      entry_closes_at: ENTRY_CLOSES,
    },
    members: [],
    hidden_picks: [],
    games: GAMES,
    ...over,
  };
}

function member(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    name: "Ali B.",
    role: "player",
    status: "alive",
    strikes: 0,
    eliminated_week: null,
    picks: [],
    ...over,
  };
}

describe("mapPublicSnapshot", () => {
  it("returns null for anything it doesn't recognise", () => {
    expect(mapPublicSnapshot(null, new Date(NOW))).toBeNull();
    expect(mapPublicSnapshot("nope", new Date(NOW))).toBeNull();
    expect(mapPublicSnapshot({}, new Date(NOW))).toBeNull();
    // group present but no entry_closes_at — the phase can't be derived.
    expect(
      mapPublicSnapshot({ group: { name: "x" }, members: [], games: [] }, new Date(NOW)),
    ).toBeNull();
  });

  it("resolves the current week from kickoffs", () => {
    const out = mapPublicSnapshot(snapshot(), new Date(NOW));
    expect(out?.currentWeek).toBe(6);
    expect(out?.phase).toBe("regular");
  });

  it("puts a revealed current-week pick on currentPick, not history", () => {
    const out = mapPublicSnapshot(
      snapshot({
        members: [member({ picks: [{ week: 6, team_id: "kc", game_id: "g6", result: null }] })],
      }),
      new Date(NOW),
    );
    expect(out?.members[0]!.currentPick).toEqual({ week: 6, teamId: "kc", gameId: "g6" });
    expect(out?.members[0]!.history).toEqual([]);
  });

  it("derives a past pick's result from the game when the scorer hasn't written one", () => {
    // g1: nyg 24, phi 20. Picking nyg is a win; picking phi is a loss.
    const out = mapPublicSnapshot(
      snapshot({
        members: [
          member({ picks: [{ week: 1, team_id: "nyg", game_id: "g1", result: null }] }),
          member({
            id: "m2",
            picks: [{ week: 1, team_id: "phi", game_id: "g1", result: null }],
          }),
        ],
      }),
      new Date(NOW),
    );
    expect(out?.members[0]!.history).toEqual([{ week: 1, teamId: "nyg", result: "win" }]);
    expect(out?.members[1]!.history).toEqual([{ week: 1, teamId: "phi", result: "loss" }]);
  });

  it("prefers a stored result over a derived one", () => {
    const out = mapPublicSnapshot(
      snapshot({
        members: [member({ picks: [{ week: 1, team_id: "phi", game_id: "g1", result: "push" }] })],
      }),
      new Date(NOW),
    );
    expect(out?.members[0]!.history).toEqual([{ week: 1, teamId: "phi", result: "push" }]);
  });

  it("lights a padlock only for a hidden pick in the CURRENT week", () => {
    const out = mapPublicSnapshot(
      snapshot({
        members: [member(), member({ id: "m2" })],
        hidden_picks: [
          { member_id: "m1", week: 6 }, // this week — padlock
          { member_id: "m2", week: 7 }, // a later week — must NOT padlock
        ],
      }),
      new Date(NOW),
    );
    expect(out?.hiddenPickUserIds).toEqual(["m1"]);
  });

  it("narrows games to the current week only", () => {
    // Pins the invariant documented on PublicLeagueData.games: StandingsGrid
    // consults gameForTeam solely from its week === currentWeek branch.
    const out = mapPublicSnapshot(snapshot(), new Date(NOW));
    expect(out?.games.map((g) => g.id)).toEqual(["g6"]);
  });

  it("reports preseason before the first Week 1 kickoff", () => {
    const out = mapPublicSnapshot(
      snapshot({
        now: "2025-08-01T00:00:00Z",
        members: [member(), member({ id: "m2" })],
      }),
      new Date(NOW),
    );
    expect(out?.phase).toBe("preseason");
    expect(out?.headcount.kind).toBe("preseason");
    if (out?.headcount.kind === "preseason") expect(out.headcount.joined).toBe(2);
  });

  it("counts the living and the dead in the season headcount", () => {
    const out = mapPublicSnapshot(
      snapshot({
        members: [
          member(),
          member({ id: "m2", status: "eliminated", eliminated_week: 3, strikes: 1 }),
        ],
      }),
      new Date(NOW),
    );
    expect(out?.headcount).toEqual({ kind: "season", week: 6, alive: 1, eliminated: 1, total: 2 });
  });

  it("never carries name parts, avatar, phone or buy-in through", () => {
    const out = mapPublicSnapshot(snapshot({ members: [member()] }), new Date(NOW));
    const m = out!.members[0]!;
    expect(m.name).toBe("Ali B."); // already abbreviated in SQL
    expect(m.firstName).toBe("");
    expect(m.lastName).toBe("");
    expect(m.favoriteAnimal).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.buyInPaid).toBe(false);
  });

  it("trusts the database clock over the server's", () => {
    const out = mapPublicSnapshot(snapshot(), new Date("2020-01-01T00:00:00Z"));
    expect(out?.nowIso).toBe(new Date(NOW).toISOString());
  });
});

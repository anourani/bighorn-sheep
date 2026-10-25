import { describe, expect, it } from "vitest";
import { recomputeSeason, sameInstant } from "./score";

/**
 * A stand-in for the service client: answers each table's select from `tables`
 * and records every update instead of applying it. Enough of the builder chain
 * for what `recomputeSeason` calls — eq/lte filters are ignored, since every
 * fixture row already belongs to the one season, group and phase under test.
 */
function fakeClient(tables: Record<string, unknown[]>) {
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      lte: () => query,
      then: (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null }),
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { eq: async () => ({ error: null }) };
      },
    };
    return query;
  };
  return { client: { from } as never, updates };
}

const KICKOFF = "2026-09-13T17:00:00+00:00";
const NOW = new Date("2026-09-15T12:00:00Z");

const game = {
  id: "g1",
  season: 2026,
  season_type: "regular",
  week: 1,
  kickoff: KICKOFF,
  status: "final",
  home: "KC",
  away: "BAL",
  home_score: 27,
  away_score: 20,
  status_detail: null,
};
const group = { id: "grp", season: 2026, elimination_type: "single", tie_rule: "push" };
const member = {
  id: "m1",
  group_id: "grp",
  user_id: "u1",
  entry_no: 1,
  strikes: 0,
  status: "alive",
  eliminated_week: null,
};
const pick = {
  id: "p1",
  group_id: "grp",
  user_id: "u1",
  entry_no: 1,
  season_type: "regular",
  week: 1,
  game_id: "g1",
  team_id: "KC",
  result: null as string | null,
  locked_at: null as string | null,
};

describe("recomputeSeason", () => {
  it("writes a pick whose result has not been recorded yet", async () => {
    const { client, updates } = fakeClient({
      games: [game],
      groups: [group],
      group_members: [member],
      picks: [pick],
    });
    const res = await recomputeSeason(client, 2026, 1, NOW);
    expect(updates).toEqual([
      { table: "picks", values: { result: "win", locked_at: KICKOFF } },
    ]);
    expect(res.membersUpdated).toBe(1);
  });

  it("writes nothing when every row already holds the computed value", async () => {
    // The steady state between games: the cron runs, nothing has finished, and
    // every write would have put back what was already there.
    const { client, updates } = fakeClient({
      games: [game],
      groups: [group],
      group_members: [member],
      // Same instant, different spelling — the case a string test gets wrong.
      picks: [{ ...pick, result: "win", locked_at: "2026-09-13T17:00:00.000Z" }],
    });
    const res = await recomputeSeason(client, 2026, 1, NOW);
    expect(updates).toEqual([]);
    // Still counted: the Data Feed tab reads this as "players covered".
    expect(res.membersUpdated).toBe(1);
  });

  it("writes the member row when the fold changes their standing", async () => {
    const { client, updates } = fakeClient({
      games: [{ ...game, home_score: 10 }],
      groups: [group],
      group_members: [member],
      picks: [{ ...pick, result: "win", locked_at: KICKOFF }],
    });
    await recomputeSeason(client, 2026, 1, NOW);
    expect(updates).toEqual([
      { table: "picks", values: { result: "loss", locked_at: KICKOFF } },
      {
        table: "group_members",
        values: { strikes: 1, status: "eliminated", eliminated_week: 1 },
      },
    ]);
  });
});

describe("sameInstant", () => {
  it("treats two spellings of one moment as equal", () => {
    expect(sameInstant("2026-09-13T17:00:00+00:00", "2026-09-13T17:00:00.000Z")).toBe(true);
  });
  it("tells different moments apart", () => {
    expect(sameInstant("2026-09-13T17:00:00Z", "2026-09-13T20:25:00Z")).toBe(false);
  });
  it("matches null only against null", () => {
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant(null, "2026-09-13T17:00:00Z")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PRE_WEEK, REGULAR_WEEK, weekKey } from "../nfl/calendar";
import type { TeamId } from "../nfl/types";
import { pickForWeek, pruneAgreedPicks, viewerPicksByWeek, type PendingPicks } from "./picks";

const NOTHING_PENDING: PendingPicks = new Map();

function pending(entries: [string, TeamId | null][]): PendingPicks {
  return new Map(entries);
}

describe("viewerPicksByWeek", () => {
  // The reason the index is keyed by weekKey and not by week number. A member
  // can hold a preseason week 1 pick AND an opening-Sunday pick at the same
  // time; they are separate games and must not overwrite each other.
  it("keeps preseason week 1 and regular week 1 apart", () => {
    const picks = viewerPicksByWeek({
      currentPick: { week: 1, teamId: "kc" },
      practicePicks: [{ week: 1, teamId: "phi" }],
    });

    expect(picks.size).toBe(2);
    expect(pickForWeek(PRE_WEEK(1), picks, NOTHING_PENDING)).toBe("phi");
    expect(pickForWeek(REGULAR_WEEK(1), picks, NOTHING_PENDING)).toBe("kc");
  });

  it("indexes resolved history alongside the live week's pick", () => {
    const picks = viewerPicksByWeek({
      history: [
        { week: 3, teamId: "buf" },
        { week: 4, teamId: "dal" },
      ],
      currentPick: { week: 5, teamId: "sf" },
    });

    expect(pickForWeek(REGULAR_WEEK(3), picks, NOTHING_PENDING)).toBe("buf");
    expect(pickForWeek(REGULAR_WEEK(4), picks, NOTHING_PENDING)).toBe("dal");
    expect(pickForWeek(REGULAR_WEEK(5), picks, NOTHING_PENDING)).toBe("sf");
  });

  // history is weeks < currentWeek, so this cannot happen today. Pinned anyway:
  // currentPick is the live row, history is a derived read of older ones.
  it("lets currentPick win if a week somehow appears in both", () => {
    const picks = viewerPicksByWeek({
      history: [{ week: 5, teamId: "buf" }],
      currentPick: { week: 5, teamId: "sf" },
    });

    expect(pickForWeek(REGULAR_WEEK(5), picks, NOTHING_PENDING)).toBe("sf");
  });

  it("takes every practice pick, not just the live week's", () => {
    const picks = viewerPicksByWeek({
      practicePicks: [
        { week: 1, teamId: "kc" },
        { week: 2, teamId: "sea" },
      ],
    });

    expect(picks.size).toBe(2);
  });

  it("copes with a member who has picked nothing", () => {
    expect(viewerPicksByWeek({}).size).toBe(0);
    expect(viewerPicksByWeek({ currentPick: null }).size).toBe(0);
  });
});

describe("pickForWeek", () => {
  // THE BUG THIS MODULE EXISTS FOR. With practice picks in weeks 1 and 2, the
  // pick module used to render whichever team belonged to the LIVE week no
  // matter which week the strip named — so selecting Preseason 2 still showed the
  // Preseason 1 team, with Preseason 1's opponent and kickoff.
  it("answers for the week asked about, not the live one", () => {
    const picks = viewerPicksByWeek({
      practicePicks: [
        { week: 1, teamId: "kc" },
        { week: 2, teamId: "sea" },
      ],
    });

    expect(pickForWeek(PRE_WEEK(1), picks, NOTHING_PENDING)).toBe("kc");
    expect(pickForWeek(PRE_WEEK(2), picks, NOTHING_PENDING)).toBe("sea");
  });

  it("returns null for a week with no pick", () => {
    const picks = viewerPicksByWeek({ practicePicks: [{ week: 1, teamId: "kc" }] });

    expect(pickForWeek(PRE_WEEK(3), picks, NOTHING_PENDING)).toBeNull();
    expect(pickForWeek(REGULAR_WEEK(5), new Map(), NOTHING_PENDING)).toBeNull();
  });

  it("prefers an in-flight pick over server truth", () => {
    const picks = viewerPicksByWeek({ practicePicks: [{ week: 2, teamId: "sea" }] });
    const inFlight = pending([[weekKey(PRE_WEEK(2)), "buf"]]);

    expect(pickForWeek(PRE_WEEK(2), picks, inFlight)).toBe("buf");
  });

  // The failure mode of a single scalar pick: when the live week advanced with
  // the tab open, last week's team was rendered under the new week's label.
  it("confines an in-flight pick to the week it was made for", () => {
    const picks = viewerPicksByWeek({
      practicePicks: [{ week: 1, teamId: "kc" }],
      currentPick: { week: 2, teamId: "dal" },
    });
    const inFlight = pending([[weekKey(PRE_WEEK(2)), "buf"]]);

    expect(pickForWeek(PRE_WEEK(1), picks, inFlight)).toBe("kc");
    expect(pickForWeek(PRE_WEEK(3), picks, inFlight)).toBeNull();
    // Same week number, other phase — the overlay must not cross over.
    expect(pickForWeek(REGULAR_WEEK(2), picks, inFlight)).toBe("dal");
  });

  // Why the lookup tests `has` rather than falling through on a nullish value:
  // a rejected pick reverts to "no pick", and the server map is still stale.
  it("honours an explicit null revert over a populated server entry", () => {
    const picks = viewerPicksByWeek({ practicePicks: [{ week: 2, teamId: "sea" }] });
    const reverted = pending([[weekKey(PRE_WEEK(2)), null]]);

    expect(pickForWeek(PRE_WEEK(2), picks, reverted)).toBeNull();
  });

  it("adds a pick for a week the server has never seen", () => {
    const inFlight = pending([[weekKey(REGULAR_WEEK(1)), "kc"]]);

    expect(pickForWeek(REGULAR_WEEK(1), new Map(), inFlight)).toBe("kc");
  });
});

describe("pruneAgreedPicks", () => {
  it("drops entries the server has caught up with, keeping the rest", () => {
    const server = viewerPicksByWeek({ currentPick: { week: 2, teamId: "kc" } });
    const overlay = pending([
      [weekKey(REGULAR_WEEK(2)), "kc"], // landed — server agrees
      [weekKey(PRE_WEEK(1)), "sea"], // still in flight — server has nothing
    ]);

    const pruned = pruneAgreedPicks(overlay, server);

    expect(pruned.has(weekKey(REGULAR_WEEK(2)))).toBe(false);
    expect(pruned.get(weekKey(PRE_WEEK(1)))).toBe("sea");
  });

  // A reverted pick writes an explicit null; once the server map also has no
  // entry for that week, the two say the same thing and the null can go.
  it("treats an explicit null against a server absence as agreement", () => {
    const overlay = pending([[weekKey(REGULAR_WEEK(2)), null]]);

    expect(pruneAgreedPicks(overlay, new Map()).size).toBe(0);
  });

  it("keeps an entry that disagrees with a populated server value", () => {
    const server = viewerPicksByWeek({ currentPick: { week: 2, teamId: "kc" } });
    const overlay = pending([[weekKey(REGULAR_WEEK(2)), "sea"]]);

    expect(pruneAgreedPicks(overlay, server)).toBe(overlay);
  });

  // The setState bail-out: an unchanged result must be the same object, or the
  // effect that calls this re-renders the screen on every server refresh.
  it("returns the same map identity when nothing changed", () => {
    const empty = pending([]);
    expect(pruneAgreedPicks(empty, new Map())).toBe(empty);

    const server = viewerPicksByWeek({ currentPick: { week: 2, teamId: "kc" } });
    const disagreeing = pending([[weekKey(REGULAR_WEEK(2)), "sea"]]);
    expect(pruneAgreedPicks(disagreeing, server)).toBe(disagreeing);
  });
});

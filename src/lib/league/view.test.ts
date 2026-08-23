import { describe, expect, it } from "vitest";
import type { Game, TeamId } from "../nfl/types";
import type { Member, TeamRecord } from "./types";
import {
  countNoun,
  orderPickerTeams,
  rankMembers,
  statusLabel,
  statusLine,
  survivorCounts,
  teamScoreline,
  type TeamAvailability,
} from "./view";

function game(kickoff: string, home: TeamId, away: TeamId): Game {
  return {
    id: `g_${home}_${away}`,
    season: 2025,
    seasonType: "regular",
    week: 6,
    kickoff,
    status: "scheduled",
    home,
    away,
    homeScore: null,
    awayScore: null,
  };
}

const EARLY = "2025-10-12T17:00:00.000Z";
const LATE = "2025-10-12T20:25:00.000Z";
const NIGHT = "2025-10-14T00:15:00.000Z";

const RECORDS: Record<string, TeamRecord> = {
  kc: { w: 5, l: 1, t: 0 },
  buf: { w: 4, l: 2, t: 0 },
  dal: { w: 3, l: 3, t: 0 },
  sf: { w: 4, l: 2, t: 0 },
  det: { w: 5, l: 1, t: 0 },
  cin: { w: 3, l: 3, t: 0 },
};

const GAMES: Record<string, Game | undefined> = {
  kc: game(LATE, "kc", "jax"),
  buf: game(EARLY, "ne", "buf"),
  dal: game(NIGHT, "wsh", "dal"),
  sf: game(EARLY, "sf", "tb"),
  det: game(EARLY, "tb", "det"),
  cin: undefined, // on bye — no game this week
};

const recordFor = (id: TeamId): TeamRecord => RECORDS[id] ?? { w: 0, l: 0, t: 0 };
const gameFor = (id: TeamId): Game | undefined => GAMES[id];

// Alphabetical base order, matching how TEAMS is declared.
const BASE: TeamId[] = ["buf", "cin", "dal", "det", "kc", "sf"];

const states = new Map<TeamId, TeamAvailability>([
  ["buf", { state: "available" }],
  ["cin", { state: "bye" }],
  ["dal", { state: "available" }],
  ["det", { state: "selected" }],
  ["kc", { state: "available" }],
  ["sf", { state: "used", week: 4, result: "win" }],
]);

const accessors = { recordFor, gameFor };

describe("orderPickerTeams", () => {
  it("keeps only pickable + selected teams when availableOnly, in base order", () => {
    const out = orderPickerTeams(BASE, states, { sort: "default", availableOnly: true }, accessors);
    expect(out).toEqual(["buf", "dal", "det", "kc"]);
  });

  it("default sort preserves the base order without mutating the input", () => {
    const out = orderPickerTeams(BASE, states, { sort: "default", availableOnly: false }, accessors);
    expect(out).toEqual(BASE);
    expect(BASE).toEqual(["buf", "cin", "dal", "det", "kc", "sf"]);
  });

  it("record sort orders by win% (actionable first), used/bye sunk to the bottom", () => {
    const out = orderPickerTeams(BASE, states, { sort: "record", availableOnly: false }, accessors);
    // det/kc tie at .833 → alphabetical; then buf .667, dal .5; then non-actionable sf, cin.
    expect(out).toEqual(["det", "kc", "buf", "dal", "sf", "cin"]);
  });

  it("kickoff sort orders by soonest kickoff, byes last, actionable first", () => {
    const out = orderPickerTeams(BASE, states, { sort: "kickoff", availableOnly: false }, accessors);
    // buf/det tie EARLY → alphabetical; kc LATE; dal NIGHT; then used sf (EARLY), bye cin (no game).
    expect(out).toEqual(["buf", "det", "kc", "dal", "sf", "cin"]);
  });
});

describe("statusLabel", () => {
  it("reads Still Standing for a living player mid-season", () => {
    expect(statusLabel({ status: "alive", phase: "regular" })).toBe("Still Standing");
  });

  it("names the phase for a living player outside the regular season", () => {
    expect(statusLabel({ status: "alive", phase: "preseason" })).toBe("Pre-season");
    expect(statusLabel({ status: "alive", phase: "ended" })).toBe("Season over");
  });

  it("lets elimination outrank every phase", () => {
    for (const phase of ["preseason", "regular", "ended"] as const) {
      expect(statusLabel({ status: "eliminated", phase })).toBe("Eliminated");
    }
  });
});

describe("survivorCounts", () => {
  function member(id: string, status: Member["status"]): Member {
    return {
      id,
      name: id,
      firstName: id,
      lastName: "",
      favoriteAnimal: null,
      phone: null,
      role: "player",
      status,
      strikes: 0,
      buyInPaid: false,
    buyInPaidAt: null,
    showPreseason: false,
      history: [],
      currentPick: null,
    };
  }

  it("splits members into alive and eliminated", () => {
    const out = survivorCounts([
      member("a", "alive"),
      member("b", "eliminated"),
      member("c", "alive"),
    ]);
    expect(out).toEqual({ alive: 2, eliminated: 1, total: 3 });
  });

  it("is all zeroes for an empty league", () => {
    expect(survivorCounts([])).toEqual({ alive: 0, eliminated: 0, total: 0 });
  });

  it("counts the denominator from the known statuses, not the array length", () => {
    // A row carrying a status this build doesn't know is left out of `total`
    // rather than inflating it into a "3 out of 4" that never resolves.
    const rogue = { ...member("d", "alive"), status: "zombie" as Member["status"] };
    const out = survivorCounts([member("a", "alive"), member("b", "eliminated"), rogue]);
    expect(out).toEqual({ alive: 1, eliminated: 1, total: 2 });
  });
});

describe("rankMembers", () => {
  function member(id: string, over: Partial<Member> = {}): Member {
    return {
      id,
      name: id,
      firstName: id,
      lastName: "",
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

  const ids = (ms: Member[]) => rankMembers(ms).map((r) => r.member.id);

  it("puts the living above the dead, then orders each tier on its own key", () => {
    const out = ids([
      member("dead-early", { status: "eliminated", strikes: 1, eliminatedWeek: 2 }),
      member("two-strikes", { strikes: 2 }),
      member("clean"),
      member("dead-late", { status: "eliminated", strikes: 1, eliminatedWeek: 9 }),
    ]);
    // Fewest strikes first among the living; among the dead, whoever survived
    // longest leads.
    expect(out).toEqual(["clean", "two-strikes", "dead-late", "dead-early"]);
  });

  /*
   * The practice standings board. Nothing eliminates in preseason, so
   * StandingsClient hands this an all-alive table and the ONLY thing separating
   * two rows is the practice loss count — uncapped, so a three-loss member really
   * does sit below a one-loss member. Under the old fold both were "eliminated"
   * with a capped single strike, and the dead-tier branch ordered them by
   * eliminatedWeek instead. This pins the ordering the practice grid now relies on.
   */
  it("orders an all-alive table purely on losses, then name, then id", () => {
    expect(
      ids([
        member("z-three", { name: "Zoe Z.", strikes: 3 }),
        member("b-one", { name: "Bea B.", strikes: 1 }),
        member("a-one", { name: "Ada A.", strikes: 1 }),
        member("c-none", { name: "Cal C." }),
      ]),
    ).toEqual(["c-none", "a-one", "b-one", "z-three"]);
  });

  it("is total and stable — the input order never decides the output", () => {
    const tied = [member("b", { name: "Same Name" }), member("a", { name: "Same Name" })];
    expect(ids(tied)).toEqual(["a", "b"]);
    expect(ids([...tied].reverse())).toEqual(["a", "b"]);
  });

  it("numbers the ranks from 1 in the sorted order", () => {
    expect(rankMembers([member("b", { strikes: 1 }), member("a")]).map((r) => r.rank)).toEqual([
      1, 2,
    ]);
  });
});

describe("statusLine", () => {
  it("reads the week and the tally in season", () => {
    expect(statusLine({ kind: "season", week: 6, alive: 29, eliminated: 15 })).toEqual({
      lead: "Week 6",
      leadShort: "W6",
      primary: "29 survivors.",
      secondary: "15 deaths.",
    });
  });

  it("counts down to kickoff in pre-season", () => {
    expect(statusLine({ kind: "preseason", joined: 12, startsIn: "3d 4h" })).toEqual({
      lead: "Pre-season",
      // No shorter form to give: "Pre-season" already names the whole stretch,
      // so the phone renders the same string the desktop does.
      leadShort: "Pre-season",
      primary: "Starts in 3d 4h.",
      secondary: "12 joined.",
    });
  });

  it("abbreviates the week for the phone label", () => {
    for (const week of [1, 6, 18]) {
      expect(statusLine({ kind: "season", week, alive: 1, eliminated: 0 })).toMatchObject({
        lead: `Week ${week}`,
        leadShort: `W${week}`,
      });
    }
  });

  it("singularises both nouns at one", () => {
    expect(statusLine({ kind: "season", week: 1, alive: 1, eliminated: 1 })).toMatchObject({
      primary: "1 survivor.",
      secondary: "1 death.",
    });
  });

  // "joined" is a past participle here, not a countable noun — which is exactly
  // what the old header's `{joined === 1 ? "joined" : "joined"}` was groping at.
  it("never inflects 'joined'", () => {
    for (const joined of [0, 1, 2, 40]) {
      expect(statusLine({ kind: "preseason", joined, startsIn: "1h 0m" }).secondary).toBe(
        `${joined} joined.`,
      );
    }
  });

  it("handles a wiped-out league and an untouched one", () => {
    expect(statusLine({ kind: "season", week: 18, alive: 0, eliminated: 44 })).toMatchObject({
      primary: "0 survivors.",
      secondary: "44 deaths.",
    });
    expect(statusLine({ kind: "season", week: 1, alive: 44, eliminated: 0 })).toMatchObject({
      primary: "44 survivors.",
      secondary: "0 deaths.",
    });
  });
});

describe("countNoun", () => {
  it("inflects on the number, not on the word", () => {
    expect(countNoun(1, "member")).toBe("1 member");
    expect(countNoun(27, "member")).toBe("27 members");
  });

  it("still pluralises at zero", () => {
    expect(countNoun(0, "member")).toBe("0 members");
  });

  it("takes an explicit plural for words that do not just take an s", () => {
    expect(countNoun(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("teamScoreline", () => {
  const scored = (status: Game["status"], homeScore: number, awayScore: number): Game => ({
    ...game(EARLY, "kc", "buf"),
    status,
    homeScore,
    awayScore,
  });

  it("reads the score from each side's perspective", () => {
    const g = scored("final", 24, 20);
    expect(teamScoreline(g, "kc")).toEqual({ for: 24, against: 20, opponent: "buf" });
    expect(teamScoreline(g, "buf")).toEqual({ for: 20, against: 24, opponent: "kc" });
  });

  it("shows a real 0 once the game is under way", () => {
    expect(teamScoreline(scored("in_progress", 0, 0), "kc")).toEqual({
      for: 0,
      against: 0,
      opponent: "buf",
    });
    expect(teamScoreline(scored("final", 0, 3), "kc")?.for).toBe(0);
  });

  // The one this guard exists for. ESPN sends `score: "0"` on a game nobody has
  // played and `parseScore` stores a real 0, so a null check alone would print
  // "0" on every future week. The mocks pass no scores and land null, which is
  // why this never reproduced locally.
  it("hides the feed's placeholder 0 on a game that has not been played", () => {
    expect(teamScoreline(scored("scheduled", 0, 0), "kc")).toBeNull();
    expect(teamScoreline(scored("postponed", 0, 0), "kc")).toBeNull();
  });

  it("still hides a scheduled game carrying a non-zero score", () => {
    expect(teamScoreline(scored("scheduled", 21, 17), "kc")).toBeNull();
  });

  it("counts a delayed game as played, so a real score survives the delay", () => {
    expect(teamScoreline(scored("delayed", 14, 10), "kc")?.for).toBe(14);
  });

  it("is null when either side has no score at all", () => {
    const g: Game = { ...game(EARLY, "kc", "buf"), status: "final", homeScore: 24, awayScore: null };
    expect(teamScoreline(g, "kc")).toBeNull();
  });

  it("is null for a team that is not in the game", () => {
    expect(teamScoreline(scored("final", 24, 20), "phi")).toBeNull();
  });
});

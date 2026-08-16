import { describe, expect, it } from "vitest";
import type { Game, TeamId } from "../nfl/types";
import type { Member, TeamRecord } from "./types";
import {
  orderPickerTeams,
  statusLabel,
  statusLine,
  survivorCounts,
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

describe("statusLine", () => {
  it("reads the week and the tally in season", () => {
    expect(statusLine({ kind: "season", week: 6, alive: 29, eliminated: 15 })).toEqual({
      lead: "Week 6",
      primary: "29 survivors.",
      secondary: "15 deaths.",
    });
  });

  it("counts down to kickoff in pre-season", () => {
    expect(statusLine({ kind: "preseason", joined: 12, startsIn: "3d 4h" })).toEqual({
      lead: "Pre-season",
      primary: "Starts in 3d 4h.",
      secondary: "12 joined.",
    });
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

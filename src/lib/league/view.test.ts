import { describe, expect, it } from "vitest";
import type { Game, TeamId } from "../nfl/types";
import type { TeamRecord } from "./types";
import { orderPickerTeams, type TeamAvailability } from "./view";

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

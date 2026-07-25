import type { Team, TeamId } from "./types";

export type { TeamId } from "./types";

/**
 * All 32 NFL franchises. `id` is the lowercase ESPN abbreviation so the ESPN
 * adapter can map its `team.abbreviation` straight onto our ids with a
 * `.toLowerCase()`. Colors are the primary brand hex, used only as a small
 * accent dot next to the team code (never as a large fill — the app palette
 * stays anchored in the Ecosystem Visualization tokens).
 */
export const TEAMS: Team[] = [
  { id: "ari", abbr: "ARI", location: "Arizona", name: "Cardinals", conference: "NFC", division: "West", color: "#97233F" },
  { id: "atl", abbr: "ATL", location: "Atlanta", name: "Falcons", conference: "NFC", division: "South", color: "#A71930" },
  { id: "bal", abbr: "BAL", location: "Baltimore", name: "Ravens", conference: "AFC", division: "North", color: "#241773" },
  { id: "buf", abbr: "BUF", location: "Buffalo", name: "Bills", conference: "AFC", division: "East", color: "#00338D" },
  { id: "car", abbr: "CAR", location: "Carolina", name: "Panthers", conference: "NFC", division: "South", color: "#0085CA" },
  { id: "chi", abbr: "CHI", location: "Chicago", name: "Bears", conference: "NFC", division: "North", color: "#0B162A" },
  { id: "cin", abbr: "CIN", location: "Cincinnati", name: "Bengals", conference: "AFC", division: "North", color: "#FB4F14" },
  { id: "cle", abbr: "CLE", location: "Cleveland", name: "Browns", conference: "AFC", division: "North", color: "#311D00" },
  { id: "dal", abbr: "DAL", location: "Dallas", name: "Cowboys", conference: "NFC", division: "East", color: "#041E42" },
  { id: "den", abbr: "DEN", location: "Denver", name: "Broncos", conference: "AFC", division: "West", color: "#FB4F14" },
  { id: "det", abbr: "DET", location: "Detroit", name: "Lions", conference: "NFC", division: "North", color: "#0076B6" },
  { id: "gb", abbr: "GB", location: "Green Bay", name: "Packers", conference: "NFC", division: "North", color: "#203731" },
  { id: "hou", abbr: "HOU", location: "Houston", name: "Texans", conference: "AFC", division: "South", color: "#03202F" },
  { id: "ind", abbr: "IND", location: "Indianapolis", name: "Colts", conference: "AFC", division: "South", color: "#002C5F" },
  { id: "jax", abbr: "JAX", location: "Jacksonville", name: "Jaguars", conference: "AFC", division: "South", color: "#006778" },
  { id: "kc", abbr: "KC", location: "Kansas City", name: "Chiefs", conference: "AFC", division: "West", color: "#E31837" },
  { id: "lv", abbr: "LV", location: "Las Vegas", name: "Raiders", conference: "AFC", division: "West", color: "#000000" },
  { id: "lac", abbr: "LAC", location: "Los Angeles", name: "Chargers", conference: "AFC", division: "West", color: "#0080C6" },
  { id: "lar", abbr: "LAR", location: "Los Angeles", name: "Rams", conference: "NFC", division: "West", color: "#003594" },
  { id: "mia", abbr: "MIA", location: "Miami", name: "Dolphins", conference: "AFC", division: "East", color: "#008E97" },
  { id: "min", abbr: "MIN", location: "Minnesota", name: "Vikings", conference: "NFC", division: "North", color: "#4F2683" },
  { id: "ne", abbr: "NE", location: "New England", name: "Patriots", conference: "AFC", division: "East", color: "#002244" },
  { id: "no", abbr: "NO", location: "New Orleans", name: "Saints", conference: "NFC", division: "South", color: "#D3BC8D" },
  { id: "nyg", abbr: "NYG", location: "New York", name: "Giants", conference: "NFC", division: "East", color: "#0B2265" },
  { id: "nyj", abbr: "NYJ", location: "New York", name: "Jets", conference: "AFC", division: "East", color: "#125740" },
  { id: "phi", abbr: "PHI", location: "Philadelphia", name: "Eagles", conference: "NFC", division: "East", color: "#004C54" },
  { id: "pit", abbr: "PIT", location: "Pittsburgh", name: "Steelers", conference: "AFC", division: "North", color: "#FFB612" },
  { id: "sf", abbr: "SF", location: "San Francisco", name: "49ers", conference: "NFC", division: "West", color: "#AA0000" },
  { id: "sea", abbr: "SEA", location: "Seattle", name: "Seahawks", conference: "NFC", division: "West", color: "#002244" },
  { id: "tb", abbr: "TB", location: "Tampa Bay", name: "Buccaneers", conference: "NFC", division: "South", color: "#D50A0A" },
  { id: "ten", abbr: "TEN", location: "Tennessee", name: "Titans", conference: "AFC", division: "South", color: "#0C2340" },
  { id: "wsh", abbr: "WSH", location: "Washington", name: "Commanders", conference: "NFC", division: "East", color: "#5A1414" },
];

const TEAM_BY_ID: Map<TeamId, Team> = new Map(TEAMS.map((t) => [t.id, t]));

/** Common ESPN abbreviation aliases → our canonical id. */
const ABBR_ALIASES: Record<string, TeamId> = {
  was: "wsh",
  jac: "jax",
  lasv: "lv",
  oak: "lv",
  sd: "lac",
  stl: "lar",
};

export function getTeam(id: TeamId): Team | undefined {
  return TEAM_BY_ID.get(id);
}

/** Resolve a possibly-aliased provider abbreviation to a canonical team. */
export function teamFromAbbr(abbr: string): Team | undefined {
  const key = abbr.trim().toLowerCase();
  const canonical = ABBR_ALIASES[key] ?? key;
  return TEAM_BY_ID.get(canonical);
}

export const TEAM_COUNT = TEAMS.length;

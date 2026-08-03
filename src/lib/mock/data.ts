import type { Game, GameStatus, TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";
import type { Group, Member, TeamRecord } from "../league/types";
import { formatDisplayName } from "../league/name";

/**
 * Demo seed data. This lets every screen render fully — with a lifelike
 * mid-season state — before Supabase is wired in. It is also what the `mock`
 * NFL provider serves. Nothing here is load-bearing for production; the real
 * data comes from the ESPN provider + Postgres.
 *
 * A fixed `DEMO_NOW` freezes the snapshot at Sunday afternoon of Week 6, so the
 * board shows the full spread of states at once: a finished Thursday game
 * (picks revealed, one fresh elimination), live 1pm games (picks revealed,
 * scores moving), and not-yet-kicked afternoon/MNF games (opponents' picks
 * still hidden behind the per-game privacy lock).
 */

export const SEASON = 2025;
export const FINAL_WEEK = 18;

/**
 * Demo preview toggle. Default is the mid-season Week 6 snapshot. Set
 * NEXT_PUBLIC_DEMO_PRESEASON=1 to freeze the clock before Week 1 kickoff and
 * preview the pre-season experience (a fresh entrant: no history, entry open,
 * countdown to kickoff, roster of who's joined). Production ignores this — it
 * derives the phase from the real clock vs. the league's entry deadline.
 */
const PRESEASON_PREVIEW = process.env.NEXT_PUBLIC_DEMO_PRESEASON === "1";

export const CURRENT_WEEK = PRESEASON_PREVIEW ? 1 : 6;

/** Frozen "now" for the demo. Real app uses the actual clock. */
export const DEMO_NOW = new Date(
  PRESEASON_PREVIEW ? "2025-08-28T12:00:00.000Z" : "2025-10-12T17:30:00.000Z",
);

export const YOU_ID = "u_alex";

// ── Week 6 kickoff slots (UTC) ──────────────────────────────────────────────
const THU = "2025-10-10T00:15:00.000Z"; // Thu 8:15pm ET — FINAL by now
const SUN_1 = "2025-10-12T17:00:00.000Z"; // Sun 1:00pm ET — in progress by now
const SUN_4 = "2025-10-12T20:25:00.000Z"; // Sun 4:25pm ET — not kicked yet
const SNF = "2025-10-13T00:20:00.000Z"; // Sun 8:20pm ET
const MNF = "2025-10-14T00:15:00.000Z"; // Mon 8:15pm ET — last kickoff of week

let gameSeq = 0;
function makeGame(part: {
  week: number;
  home: TeamId;
  away: TeamId;
  kickoff: string;
  status: GameStatus;
  homeScore?: number;
  awayScore?: number;
  statusDetail?: string;
}): Game {
  gameSeq += 1;
  return {
    id: `g_${part.week}_${gameSeq}`,
    season: SEASON,
    seasonType: "regular",
    week: part.week,
    kickoff: part.kickoff,
    status: part.status,
    home: part.home,
    away: part.away,
    homeScore: part.homeScore ?? null,
    awayScore: part.awayScore ?? null,
    statusDetail: part.statusDetail,
  };
}

// ── Week 6: hand-curated so picked teams land in known states ───────────────
const WEEK6_BYES: TeamId[] = ["cin", "car"];
const week6: Game[] = [
  // Thursday — final. NYG upsets PHI, so anyone on PHI takes a loss now.
  makeGame({ week: 6, home: "nyg", away: "phi", kickoff: THU, status: "final", homeScore: 24, awayScore: 20, statusDetail: "Final" }),
  // Sunday 1pm — live. Picked teams here are revealed to the whole group.
  makeGame({ week: 6, home: "jax", away: "kc", kickoff: SUN_1, status: "in_progress", homeScore: 7, awayScore: 14, statusDetail: "2nd 05:12" }),
  makeGame({ week: 6, home: "ne", away: "buf", kickoff: SUN_1, status: "in_progress", homeScore: 10, awayScore: 10, statusDetail: "2nd 01:40" }),
  makeGame({ week: 6, home: "atl", away: "ari", kickoff: SUN_1, status: "in_progress", homeScore: 17, awayScore: 13, statusDetail: "3rd 10:00" }),
  makeGame({ week: 6, home: "cle", away: "chi", kickoff: SUN_1, status: "in_progress", homeScore: 3, awayScore: 6, statusDetail: "1st 02:22" }),
  makeGame({ week: 6, home: "gb", away: "den", kickoff: SUN_1, status: "in_progress", homeScore: 21, awayScore: 14, statusDetail: "3rd 08:45" }),
  makeGame({ week: 6, home: "lv", away: "hou", kickoff: SUN_1, status: "in_progress", homeScore: 7, awayScore: 20, statusDetail: "2nd 00:33" }),
  makeGame({ week: 6, home: "mia", away: "lac", kickoff: SUN_1, status: "in_progress", homeScore: 14, awayScore: 14, statusDetail: "2nd 07:10" }),
  // Sunday 4:25pm — not kicked. Picked teams here stay hidden from others.
  makeGame({ week: 6, home: "wsh", away: "dal", kickoff: SUN_4, status: "scheduled" }),
  makeGame({ week: 6, home: "lar", away: "sea", kickoff: SUN_4, status: "scheduled" }),
  makeGame({ week: 6, home: "no", away: "min", kickoff: SUN_4, status: "scheduled" }),
  makeGame({ week: 6, home: "pit", away: "nyj", kickoff: SUN_4, status: "scheduled" }),
  makeGame({ week: 6, home: "ten", away: "sf", kickoff: SUN_4, status: "scheduled" }),
  // Sunday night + Monday night (the week's final kickoff).
  makeGame({ week: 6, home: "tb", away: "det", kickoff: SNF, status: "scheduled" }),
  makeGame({ week: 6, home: "ind", away: "bal", kickoff: MNF, status: "scheduled" }),
];

// ── Lookahead weeks: generated round-robin so matchups vary week to week ─────
function circlePairs(teams: TeamId[], round: number): [TeamId, TeamId][] {
  const n = teams.length; // even
  const fixed = teams[0]!;
  const rest = teams.slice(1);
  const r = ((round % rest.length) + rest.length) % rest.length;
  const rotated = [...rest.slice(r), ...rest.slice(0, r)];
  const circle = [fixed, ...rotated];
  const pairs: [TeamId, TeamId][] = [];
  for (let i = 0; i < n / 2; i++) {
    pairs.push([circle[i]!, circle[n - 1 - i]!]);
  }
  return pairs;
}

function generatedWeek(
  week: number,
  byes: TeamId[],
  slots: { thu: string; sun1: string; sun4: string; mnf: string },
): Game[] {
  const playing = TEAMS.map((t) => t.id).filter((id) => !byes.includes(id));
  const pairs = circlePairs(playing, week);
  return pairs.map(([away, home], i) => {
    let kickoff = slots.sun1;
    if (i === 0) kickoff = slots.thu;
    else if (i === pairs.length - 1) kickoff = slots.mnf;
    else if (i % 2 === 0) kickoff = slots.sun4;
    return makeGame({ week, home, away, kickoff, status: "scheduled" });
  });
}

// Week 1 — no byes in the NFL's opening week. The Thursday kickoff matches the
// league's entryClosesAt, so a preseason preview shows a full, pickable slate.
const week1 = generatedWeek(1, [], {
  thu: "2025-09-05T00:20:00.000Z",
  sun1: "2025-09-07T17:00:00.000Z",
  sun4: "2025-09-07T20:25:00.000Z",
  mnf: "2025-09-09T00:15:00.000Z",
});

const week7 = generatedWeek(7, ["mia", "den"], {
  thu: "2025-10-17T00:15:00.000Z",
  sun1: "2025-10-19T17:00:00.000Z",
  sun4: "2025-10-19T20:25:00.000Z",
  mnf: "2025-10-21T00:15:00.000Z",
});
const week8 = generatedWeek(8, ["sf", "pit"], {
  thu: "2025-10-24T00:15:00.000Z",
  sun1: "2025-10-26T17:00:00.000Z",
  sun4: "2025-10-26T20:25:00.000Z",
  mnf: "2025-10-27T00:15:00.000Z",
});

/**
 * Games keyed by week. Weeks with no entry (9+) model the "schedule not yet
 * released" state the UI must handle gracefully.
 */
export const WEEK_GAMES: Record<number, Game[]> = {
  1: week1,
  6: week6,
  7: week7,
  8: week8,
};

export const BYES_BY_WEEK: Record<number, TeamId[]> = {
  1: [],
  6: WEEK6_BYES,
  7: ["mia", "den"],
  8: ["sf", "pit"],
};

/** The last kickoff of a week — the true final pick deadline for that week. */
export function weekFinalKickoff(week: number): Date | null {
  const games = WEEK_GAMES[week];
  if (!games || games.length === 0) return null;
  return games.reduce((latest, g) => {
    const k = new Date(g.kickoff);
    return k > latest ? k : latest;
  }, new Date(0));
}

// ── Team standings (demo) ────────────────────────────────────────────────────
/**
 * Cosmetic season records through the current week, used only to power the
 * "Best record" sort in the team picker. Real standings come from the provider
 * feed / Postgres; nothing here is load-bearing.
 */
export const STANDINGS: Record<TeamId, TeamRecord> = {
  ari: { w: 2, l: 4, t: 0 },
  atl: { w: 3, l: 3, t: 0 },
  bal: { w: 4, l: 2, t: 0 },
  buf: { w: 4, l: 2, t: 0 },
  car: { w: 1, l: 5, t: 0 },
  chi: { w: 2, l: 4, t: 0 },
  cin: { w: 3, l: 3, t: 0 },
  cle: { w: 1, l: 5, t: 0 },
  dal: { w: 3, l: 3, t: 0 },
  den: { w: 4, l: 2, t: 0 },
  det: { w: 5, l: 1, t: 0 },
  gb: { w: 4, l: 2, t: 0 },
  hou: { w: 3, l: 3, t: 0 },
  ind: { w: 4, l: 2, t: 0 },
  jax: { w: 3, l: 3, t: 0 },
  kc: { w: 5, l: 1, t: 0 },
  lv: { w: 2, l: 4, t: 0 },
  lac: { w: 4, l: 2, t: 0 },
  lar: { w: 4, l: 2, t: 0 },
  mia: { w: 1, l: 5, t: 0 },
  min: { w: 4, l: 2, t: 0 },
  ne: { w: 2, l: 4, t: 0 },
  no: { w: 1, l: 5, t: 0 },
  nyg: { w: 2, l: 4, t: 0 },
  nyj: { w: 0, l: 6, t: 0 },
  phi: { w: 4, l: 2, t: 0 },
  pit: { w: 4, l: 2, t: 0 },
  sf: { w: 4, l: 2, t: 0 },
  sea: { w: 4, l: 2, t: 0 },
  tb: { w: 4, l: 2, t: 0 },
  ten: { w: 1, l: 5, t: 0 },
  wsh: { w: 3, l: 3, t: 0 },
};

/** A team's season record (defaults to 0-0-0 for safety under strict indexing). */
export function teamRecord(id: TeamId): TeamRecord {
  return STANDINGS[id] ?? { w: 0, l: 0, t: 0 };
}

// ── The league ──────────────────────────────────────────────────────────────
export const GROUP: Group = {
  id: "grp_bighorn",
  name: "Bighorn Survivors",
  season: SEASON,
  rules: { eliminationType: "two_time", tieRule: "push" },
  inviteCode: "BIGHORN-7F3K",
  entryClosesAt: "2025-09-05T00:20:00.000Z", // Week 1 kickoff
  settingsLockedAt: "2025-09-05T00:20:00.000Z",
};

/** Full-name seed rows; first/last/avatar are derived below so this stays terse. */
type SeedMember = Omit<Member, "firstName" | "lastName" | "avatarUrl">;

const SEED_MEMBERS: SeedMember[] = [
  {
    id: YOU_ID,
    name: "Alex Nourani",
    role: "admin",
    status: "alive",
    strikes: 0,
    history: [
      { week: 1, teamId: "sf", result: "win" },
      { week: 2, teamId: "bal", result: "win" },
      { week: 3, teamId: "mia", result: "win" },
      { week: 4, teamId: "det", result: "win" },
      { week: 5, teamId: "lac", result: "win" },
    ],
    currentPick: { week: 6, teamId: "dal", gameId: "g_6_9" },
  },
  {
    id: "u_mark",
    name: "Mark Rivera",
    role: "player",
    status: "alive",
    strikes: 1,
    history: [
      { week: 1, teamId: "phi", result: "win" },
      { week: 2, teamId: "sf", result: "loss" },
      { week: 3, teamId: "bal", result: "win" },
      { week: 4, teamId: "gb", result: "win" },
      { week: 5, teamId: "min", result: "win" },
    ],
    currentPick: { week: 6, teamId: "kc", gameId: "g_6_2" },
  },
  {
    id: "u_sarah",
    name: "Sarah Chen",
    role: "player",
    status: "alive",
    strikes: 0,
    history: [
      { week: 1, teamId: "det", result: "win" },
      { week: 2, teamId: "kc", result: "win" },
      { week: 3, teamId: "phi", result: "win" },
      { week: 4, teamId: "sf", result: "win" },
      { week: 5, teamId: "bal", result: "win" },
    ],
    currentPick: { week: 6, teamId: "buf", gameId: "g_6_3" },
  },
  {
    id: "u_priya",
    name: "Priya Patel",
    role: "player",
    status: "alive",
    strikes: 1,
    history: [
      { week: 1, teamId: "dal", result: "win" },
      { week: 2, teamId: "mia", result: "win" },
      { week: 3, teamId: "cin", result: "loss" },
      { week: 4, teamId: "kc", result: "win" },
      { week: 5, teamId: "phi", result: "win" },
    ],
    currentPick: { week: 6, teamId: "sea", gameId: "g_6_10" },
  },
  {
    id: "u_jordan",
    name: "Jordan Lee",
    role: "player",
    status: "eliminated",
    strikes: 2,
    eliminatedWeek: 6,
    history: [
      { week: 1, teamId: "sf", result: "win" },
      { week: 2, teamId: "cin", result: "win" },
      { week: 3, teamId: "buf", result: "loss" },
      { week: 4, teamId: "det", result: "win" },
      { week: 5, teamId: "kc", result: "win" },
    ],
    // Picked PHI for Week 6; PHI lost Thursday → 2nd strike → eliminated live.
    currentPick: { week: 6, teamId: "phi", gameId: "g_6_1" },
  },
  {
    id: "u_tom",
    name: "Tom Baker",
    role: "player",
    status: "eliminated",
    strikes: 2,
    eliminatedWeek: 3,
    history: [
      { week: 1, teamId: "cin", result: "loss" },
      { week: 2, teamId: "gb", result: "win" },
      { week: 3, teamId: "nyj", result: "loss" },
    ],
    currentPick: null,
  },
];

/** Derive first/last from the seed's full name and render as "First L.". */
export const MEMBERS: Member[] = SEED_MEMBERS.map((m) => {
  const [firstName = "", ...rest] = m.name.split(" ");
  const lastName = rest.join(" ");
  return { ...m, firstName, lastName, avatarUrl: null, name: formatDisplayName(firstName, lastName) };
});

export function you(): Member {
  return MEMBERS.find((m) => m.id === YOU_ID)!;
}

/** Find the game a team plays in a given week (undefined if on bye). */
export function gameForTeam(week: number, teamId: TeamId): Game | undefined {
  return (WEEK_GAMES[week] ?? []).find((g) => g.home === teamId || g.away === teamId);
}

export function gameById(id: string): Game | undefined {
  for (const games of Object.values(WEEK_GAMES)) {
    const found = games.find((g) => g.id === id);
    if (found) return found;
  }
  return undefined;
}

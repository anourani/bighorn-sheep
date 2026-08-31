import { gameWinner, isKickedOff, type Game, type TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";
import { evaluateTeamPick } from "../game/elimination";
import type { SeasonPhase } from "../game/season";
import type { GroupRules, Member, PickResult, TeamRecord } from "./types";

/**
 * Pure view-model helpers shared by the screens. They turn raw members/games
 * into exactly what the UI renders — crucially the per-game pick-privacy reveal,
 * which is derived here (and enforced for real by Postgres RLS server-side).
 */

export type TeamAvailability =
  | { state: "selected" }
  // `result` is optional: a pick still spends its team before its game has
  // produced a result, and My Picks builds this map from a used-team list that
  // carries only the week. `buildTeamStates` still fills it in.
  | { state: "used"; week: number; result?: "win" | "loss" | "push" }
  | { state: "bye" }
  | { state: "available" };

export interface SurvivorCounts {
  alive: number;
  eliminated: number;
  /** Deliberately alive + eliminated, not members.length — see below. */
  total: number;
}

/**
 * The "N out of M still alive" tally, shared by the app header and the standings
 * league summary rather than re-filtered at each call site.
 *
 * `total` counts the two known statuses instead of the array length, so a member
 * row with a status this build doesn't recognise is left out of the denominator
 * rather than silently inflating it.
 */
export function survivorCounts(members: readonly Member[]): SurvivorCounts {
  const alive = members.filter((m) => m.status === "alive").length;
  const eliminated = members.filter((m) => m.status === "eliminated").length;
  return { alive, eliminated, total: alive + eliminated };
}

/**
 * Structurally identical to `RankedMember` in StandingsGrid, declared here
 * rather than imported: this module is pure view-model logic and must not
 * depend on a component (that would be an import cycle waiting to happen).
 */
export interface RankedMemberView {
  member: Member;
  rank: number;
}

/**
 * How a living member's current week is going, in the order the table ranks
 * them. Numbered so the comparator is a subtraction rather than an index lookup
 * into a separate order array that could drift out of step with the union.
 *
 * Declared in this module and not beside the grid's other pure helpers: that
 * file imports `viewCurrentPick` from here, so the reverse import would be a
 * cycle. `lib/` never depends on `components/`.
 */
export const PICK_BUCKET = {
  won: 0,
  live: 1,
  picked: 2,
  none: 3,
  lost: 4,
} as const;

export type PickBucket = keyof typeof PICK_BUCKET;

/**
 * What ranking reads off a member's current week: which bucket they fall in,
 * and — when the league can see it — which team they went with.
 *
 * Both come off ONE `viewCurrentPick`, which walks the game index; deriving
 * them separately would double that for every member.
 *
 * `viewerId` is deliberately not a parameter: `viewCurrentPick` is called with
 * the empty string, so it takes its rival branch for EVERYONE including the
 * signed-in viewer. Rank has to be one fact about the league — if your own pick
 * counted as revealed while every rival's was hidden, your row would sort on
 * information nobody else's row was sorted on, and two players looking at the
 * same table would see different orders.
 *
 * A hidden pick therefore lands in `picked` with a null team, which is the
 * honest reading: the team-less flag says a pick exists, and "has selected a
 * team" is exactly what that bucket means. Nothing here reveals WHICH team.
 */
export interface PickSignals {
  bucket: PickBucket;
  /** The picked team once its game has kicked off, else null. */
  revealedTeam: TeamId | null;
}

export function pickSignals(
  member: Member,
  currentWeek: number,
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined,
  rules: GroupRules,
  now: Date,
  hiddenSet: ReadonlySet<string>,
): PickSignals {
  const pv = viewCurrentPick(member, "", currentWeek, gameForTeam, rules, now);
  // `revealed` is the whole test, not `hasPick`: an un-kicked pick is real but
  // secret, and clustering on a team nobody may see would leak it through the
  // row order — neighbours in the table would be neighbours because they share
  // a team, which is exactly the fact the padlock is hiding.
  const revealedTeam = pv.hasPick && pv.revealed ? (pv.teamId ?? null) : null;
  const bucket = ((): PickBucket => {
    if (!pv.hasPick) return hiddenSet.has(member.id) ? "picked" : "none";
    if (pv.status === "live") return "live";
    if (pv.status === "final") {
      // `evaluateTeamPick` has already folded the league's tie rule in, so a
      // push reaching here is one that SURVIVED. A tie in a league that counts
      // ties as losses arrives as a loss and needs no case of its own.
      if (pv.result === "loss") return "lost";
      if (pv.result === "win" || pv.result === "push") return "won";
      // Final with no resolvable result — a game marked final carrying no
      // score. It has not been lost, and calling it won would promote it above
      // people who genuinely won, so it reads as what it is: a pick that is in.
      return "picked";
    }
    // "hidden" and "scheduled" both mean a pick is in and the game has not
    // finished. They differ only in whether the team may be seen, which decides
    // the cluster but never the bucket.
    return "picked";
  })();
  return { bucket, revealedTeam };
}

/** What `rankMembers` needs to read the league's current week. */
export interface RankContext {
  currentWeek: number;
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined;
  rules: GroupRules;
  now: Date;
  /**
   * user_ids whose current-week pick is locked but not yet revealed. Under RLS
   * such a pick reaches the client as nothing but this flag, so without it a
   * rival who has picked is indistinguishable from one who has not — and would
   * sort into the wrong bucket.
   */
  hiddenPickUserIds?: readonly string[];
}

/**
 * Standings order.
 *
 * The living come first, grouped by how their CURRENT week is going: won, then
 * in progress, then picked-but-not-started, then no pick yet, then lost. That
 * is a table you read top-down as the week resolves — the people who are
 * through rise, the people still playing sit under them, and the people who
 * just went out fall to the bottom of the living block. Fewer strikes, then
 * name, then id break every tie inside a bucket, so the order stays total and
 * stable rather than depending on the input array.
 *
 * Below every living member come the eliminated, ordered by elimination week
 * DESCENDING — most recent first. That is the freeze the standings depend on:
 * the living block only ever shrinks, each new casualty stacks onto the top of
 * the dead block, and nobody already out ever moves again. Scroll far enough
 * down in week 15 and you are reading the league's history backwards, ending on
 * whoever went out first. It also means a member eliminated THIS week (the
 * highest possible elimination week) sits directly beneath the living, so the
 * "losers last" rule and the freeze agree rather than compete.
 *
 * The dead are NOT clustered by team. Their order is a positional guarantee —
 * a row that never moves again — and any secondary key would break it the week
 * a team's backers happened to shift.
 *
 * Inside a bucket, everyone who picked the SAME revealed team is bundled
 * together, and the bundles run biggest first: five Raiders backers, then four
 * Rams, then two Saints. The week reads as the league's consensus rather than
 * as an alphabetical list — you can see at a glance what most of the room did
 * and who went their own way. Members whose team is still hidden carry no
 * cluster and sit after the bundles in their bucket, since there is nothing to
 * bundle them by.
 *
 * That clustering outranks strikes deliberately: a bundle broken up by strike
 * count is not a bundle. Strikes, name and id still break every tie inside one.
 *
 * Buckets and clusters are both derived with an empty viewer id, so every
 * player sees the same order — see `pickSignals`.
 *
 * Lives here, not in StandingsClient, because the landing page ranks the same
 * members and importing the client component to reach it would drag
 * AdminSettingsDrawer, LeagueRulesModal and LeagueDetails into a signed-out
 * page's bundle.
 */
export function rankMembers(members: readonly Member[], ctx: RankContext): RankedMemberView[] {
  const hiddenSet = new Set(ctx.hiddenPickUserIds ?? []);
  // Derived once per member rather than inside the comparator, which would call
  // it O(n log n) times — and `viewCurrentPick` walks the game index on every
  // call.
  const signals = new Map<string, PickSignals>(
    members.map((m) => [
      m.id,
      pickSignals(m, ctx.currentWeek, ctx.gameForTeam, ctx.rules, ctx.now, hiddenSet),
    ]),
  );

  /*
   * How many LIVING members went with each revealed team.
   *
   * Counted over the living alone, because only they are clustered — folding
   * the dead in would let an eliminated member's pick decide the order of a
   * bundle they are not in.
   *
   * A team's game has one status, so everyone backing it lands in one bucket
   * and a league-wide count and a per-bucket count agree. Counting once is
   * simpler and says the same thing.
   */
  const backers = new Map<TeamId, number>();
  for (const m of members) {
    if (m.status !== "alive") continue;
    const t = signals.get(m.id)?.revealedTeam;
    if (t) backers.set(t, (backers.get(t) ?? 0) + 1);
  }

  const ordered = [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "alive" ? -1 : 1;
    if (a.status === "alive") {
      const as = signals.get(a.id);
      const bs = signals.get(b.id);
      const ab = as ? PICK_BUCKET[as.bucket] : 0;
      const bb = bs ? PICK_BUCKET[bs.bucket] : 0;
      if (ab !== bb) return ab - bb;

      const at = as?.revealedTeam ?? null;
      const bt = bs?.revealedTeam ?? null;
      if (at !== bt) {
        // A hidden pick has no bundle to join, so it sits after every bundle in
        // its bucket rather than being scattered among them.
        if (at === null) return 1;
        if (bt === null) return -1;
        const ac = backers.get(at) ?? 0;
        const bc = backers.get(bt) ?? 0;
        if (ac !== bc) return bc - ac;
        // Two bundles the same size. Ordered by team id so the table is stable
        // week to week and between viewers — a member key here would let one
        // player joining or leaving reshuffle bundles that did not change.
        return at.localeCompare(bt);
      }

      if (a.strikes !== b.strikes) return a.strikes - b.strikes;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    const aw = a.eliminatedWeek ?? 0;
    const bw = b.eliminatedWeek ?? 0;
    if (aw !== bw) return bw - aw;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return ordered.map((member, i) => ({ member, rank: i + 1 }));
}

/**
 * What the headcount section reads, in one shape for both of its variants.
 *
 * Discriminated on pre-season vs. not, rather than on `SeasonPhase`, because
 * "regular" and "ended" render identically — a week number and a tally — and a
 * three-armed union would invite a third copy of the same strings.
 *
 * `startsIn` has no reader since the pre-season line became a bare "N joined",
 * and it stays because the pre-season is the one state the redesign has no frame
 * for: this is the section's data contract, and the countdown is what a
 * pre-season variant would most likely want back.
 */
export type HeadcountInput =
  | { kind: "preseason"; joined: number; startsIn: string }
  | { kind: "season"; week: number; alive: number; eliminated: number };

export interface HeadcountLine {
  /** The week's name, or "Pre-season". Spoken, never drawn — see `leadShort`. */
  lead: string;
  /**
   * `lead` abbreviated — "W6" for "Week 6". This is the form the design DRAWS,
   * at every width: the desktop frame carries "W6 Headcount" too, so the pair is
   * no longer the breakpoint swap it was. `lead` survives as the string a screen
   * reader is handed, which is now the only reason there are two of them.
   *
   * Equal to `lead` in the pre-season, which has no shorter form: "Pre-season"
   * is already the short name for a stretch of weeks, not a week number.
   */
  leadShort: string;
  /** The counted half of the second line, in near-black. */
  primary: string;
  /**
   * The share of the league already out, drawn in accent beside `primary` —
   * `null` in the pre-season, where it could only ever read "0%".
   */
  percent: string | null;
  /**
   * `percent` with the noun a bare percentage does not carry. "54%" beside
   * "29 still standing" is read by eye as the share of one or the other; a
   * screen reader hearing "fifty four percent" has nothing to go on at all, so
   * the drawn span is hidden from it and this is what gets spoken.
   */
  percentLabel: string | null;
}

/**
 * `1 survivor` / `2 survivors`, with the count.
 *
 * Exported for the invite card's "27 members", which is the same shape and has
 * the same one failure mode — see `headcountLine` below for the bug that made
 * this a helper rather than a ternary at each call site. It has no caller left
 * in this file: neither half of the headcount line inflects.
 */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The headcount section's copy. Extracted from the JSX so the two variants are
 * one function with tests rather than two nearly-identical blocks — which is how
 * `{joined === 1 ? "joined" : "joined"}` survived in the old header: a plural
 * form dutifully applied to a word that has none. "joined" is a past participle
 * here ("29 joined"), not a countable noun, so it never inflects. Neither does
 * "still standing", which is why the season line stopped counting nouns too.
 */
export function headcountLine(input: HeadcountInput): HeadcountLine {
  if (input.kind === "preseason") {
    return {
      lead: "Pre-season",
      leadShort: "Pre-season",
      primary: `${input.joined} joined`,
      // Nobody is out before Week 1, so the only percentage this branch could
      // print is zero. The section drops the span rather than draw that.
      percent: null,
      percentLabel: null,
    };
  }
  const total = input.alive + input.eliminated;
  // The share ELIMINATED, not the share left. An empty league is 0/0, and NaN
  // reaches the screen as "NaN%" with nothing anywhere to say why.
  const percent = `${total === 0 ? 0 : Math.round((input.eliminated / total) * 100)}%`;
  return {
    lead: `Week ${input.week}`,
    leadShort: `W${input.week}`,
    primary: `${input.alive} still standing`,
    percent,
    percentLabel: `${percent} eliminated`,
  };
}

/**
 * One member's standing in plain language, for the account page's league card.
 *
 * Elimination outranks the calendar: a knocked-out player reads "Eliminated"
 * whatever the season is doing. Only then does the phase matter, and only to
 * distinguish a season that hasn't started from one that has.
 *
 * "Still Standing" rather than "In Season" — it says something about *you*,
 * which is what the surrounding row is for ("Player │ Still Standing │ Buy In").
 */
export function statusLabel(input: { status: Member["status"]; phase: SeasonPhase }): string {
  if (input.status === "eliminated") return "Eliminated";
  if (input.phase === "preseason") return "Pre-season";
  if (input.phase === "ended") return "Season over";
  return "Still Standing";
}

/** Per-team availability for one member's own grid (available / used / bye). */
export function buildTeamStates(
  member: Member,
  week: number,
  byes: TeamId[],
): Map<TeamId, TeamAvailability> {
  const byeSet = new Set(byes);
  const usedByTeam = new Map(member.history.map((h) => [h.teamId, h]));
  const out = new Map<TeamId, TeamAvailability>();
  for (const team of TEAMS) {
    const id = team.id;
    if (member.currentPick && member.currentPick.week === week && member.currentPick.teamId === id) {
      out.set(id, { state: "selected" });
      continue;
    }
    const used = usedByTeam.get(id);
    if (used) {
      out.set(id, { state: "used", week: used.week, result: used.result });
      continue;
    }
    out.set(id, byeSet.has(id) ? { state: "bye" } : { state: "available" });
  }
  return out;
}

export interface AvailabilityCounts {
  available: number;
  used: number;
  bye: number;
}

export function countStates(states: Map<TeamId, TeamAvailability>): AvailabilityCounts {
  let available = 0;
  let used = 0;
  let bye = 0;
  for (const v of states.values()) {
    if (v.state === "available") available += 1;
    else if (v.state === "used") used += 1;
    else if (v.state === "bye") bye += 1;
  }
  return { available, used, bye };
}

/** How the team picker orders its list. */
export type TeamSort = "record" | "kickoff" | "default";

/** Win percentage with a half-credit tie, guarding an empty (0-game) record. */
function winPct(r: TeamRecord): number {
  const games = r.w + r.l + r.t;
  return games === 0 ? 0 : (r.w + 0.5 * r.t) / games;
}

/** A team you can still act on this week (pickable, or your current pick). */
function isActionable(state: TeamAvailability): boolean {
  return state.state === "available" || state.state === "selected";
}

/**
 * Order (and optionally filter) the picker's teams. Pure and mock-free — the
 * record/schedule lookups are injected the same way `viewCurrentPick` takes
 * `gameForTeam`, so this stays unit-testable and reusable across layouts.
 *
 * `teamIds` is expected to arrive in a stable base order (the alphabetical
 * `TEAMS` order); ties fall back to that order via a stable sort.
 */
export function orderPickerTeams(
  teamIds: TeamId[],
  states: Map<TeamId, TeamAvailability>,
  opts: { sort: TeamSort; availableOnly: boolean; groupUnavailable?: boolean },
  accessors: {
    recordFor: (id: TeamId) => TeamRecord;
    gameFor: (id: TeamId) => Game | undefined;
  },
): TeamId[] {
  const stateFor = (id: TeamId): TeamAvailability => states.get(id) ?? { state: "available" };

  const ids = opts.availableOnly
    ? teamIds.filter((id) => isActionable(stateFor(id)))
    : [...teamIds];

  if (opts.sort === "default") return ids;

  return ids.sort((a, b) => {
    // Actionable teams lead; used/bye sink to the bottom (still shown, disabled).
    // Opt out with `groupUnavailable: false` and the sort is a pure ranking of
    // all 32 — which is what the grid layout wants, where a bye team with a good
    // record is still worth seeing in its rightful place.
    if (opts.groupUnavailable !== false) {
      const aAct = isActionable(stateFor(a));
      const bAct = isActionable(stateFor(b));
      if (aAct !== bAct) return aAct ? -1 : 1;
    }

    if (opts.sort === "record") {
      const diff = winPct(accessors.recordFor(b)) - winPct(accessors.recordFor(a));
      if (diff !== 0) return diff;
      return accessors.recordFor(b).w - accessors.recordFor(a).w;
    }

    // kickoff — soonest first; teams with no game (bye) sort to the end.
    const ka = accessors.gameFor(a)?.kickoff;
    const kb = accessors.gameFor(b)?.kickoff;
    if (ka === kb) return 0;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;
    return ka < kb ? -1 : 1;
  });
}

export type PickDisplayStatus = "hidden" | "scheduled" | "live" | "final" | "none";

export interface PickView {
  hasPick: boolean;
  teamId?: TeamId;
  game?: Game;
  /** Whether this viewer may see the team (own pick, or the game kicked off). */
  revealed: boolean;
  status: PickDisplayStatus;
  /** Resolved only when revealed and the game is final; "pending" while live. */
  result?: PickResult;
}

/**
 * How `member`'s current-week pick should appear to `viewerId`. Encodes the
 * privacy rule: another player's pick stays hidden until that specific team's
 * game has kicked off.
 */
export function viewCurrentPick(
  member: Member,
  viewerId: string,
  week: number,
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined,
  rules: GroupRules,
  now: Date,
): PickView {
  const pick = member.currentPick && member.currentPick.week === week ? member.currentPick : null;
  if (!pick) return { hasPick: false, revealed: true, status: "none" };

  const game = gameForTeam(week, pick.teamId);
  const isOwn = member.id === viewerId;
  const kicked = game ? isKickedOff(game, now) : false;
  const revealed = isOwn || kicked;

  let status: PickDisplayStatus = "scheduled";
  if (!revealed) status = "hidden";
  else if (game?.status === "final") status = "final";
  else if (game?.status === "in_progress" || game?.status === "delayed") status = "live";

  let result: PickResult | undefined;
  if (revealed && game) {
    result = gameWinner(game) === null ? "pending" : evaluateTeamPick(game, pick.teamId, rules);
  }

  return {
    hasPick: true,
    teamId: pick.teamId,
    game,
    revealed,
    status,
    result,
  };
}

/**
 * Whether a game has produced a score anyone should read.
 *
 * A null check on its own is NOT enough, and the reason is a trap that hides in
 * development: ESPN ships `score: "0"` on a game that has not kicked off, and
 * `parseScore` in `providers/espn.ts` turns that into a real `0` rather than
 * null — so every unplayed game in the database carries a 0-0 that looks exactly
 * like a real shutout. The mock fixtures pass no scores at all and land null, so
 * nothing local reproduces it; the first place it shows is a live schedule,
 * where every future week reads 0.
 *
 * `delayed` counts as played: a delay lands at or after the scheduled kickoff and
 * the feed carries the real score through it. The residual case is a pre-kickoff
 * weather delay, which shows 0-0 until play starts — rarer, and self-correcting,
 * where the alternative hides a real score for a game genuinely in progress.
 */
function hasBeenPlayed(game: Pick<Game, "status">): boolean {
  return game.status === "in_progress" || game.status === "final" || game.status === "delayed";
}

/** The scoreline from the picked team's perspective. */
export function teamScoreline(
  game: Game,
  teamId: TeamId,
): { for: number; against: number; opponent: TeamId } | null {
  if (!hasBeenPlayed(game)) return null;
  if (game.homeScore === null || game.awayScore === null) return null;
  if (game.home === teamId) return { for: game.homeScore, against: game.awayScore, opponent: game.away };
  if (game.away === teamId) return { for: game.awayScore, against: game.homeScore, opponent: game.home };
  return null;
}

export function opponentOf(game: Game, teamId: TeamId): TeamId {
  return game.home === teamId ? game.away : game.home;
}

export function isHome(game: Game, teamId: TeamId): boolean {
  return game.home === teamId;
}

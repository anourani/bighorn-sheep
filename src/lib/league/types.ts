import type { TeamId } from "../nfl/types";

/** One loss = out, or two losses = out. */
export type EliminationType = "single" | "two_time";

/**
 * How a tie is treated (a tie means the picked team did not win):
 *  - "push": the player survives, tie is neither win nor loss.
 *  - "loss": the tie is treated identically to a losing pick.
 * (In a two-time league a "loss" is simply one strike — see PRD note.)
 */
export type TieRule = "push" | "loss";

export type MemberStatus = "alive" | "eliminated";
export type Role = "admin" | "player";

/** Outcome of a single week's pick for a player. */
export type PickResult =
  | "win"
  | "loss"
  | "push"
  | "pending" // picked, game not final yet
  | "no_pick"; // hasn't picked and the week's final kickoff hasn't passed yet

export interface GroupRules {
  eliminationType: EliminationType;
  tieRule: TieRule;
}

export interface Group {
  id: string;
  name: string;
  season: number;
  rules: GroupRules;
  inviteCode: string;
  /**
   * First kickoff of Week 1 — the season has started (survival convention).
   *
   * This is NOT when joining stops; see `joinClosesAt` below. It is what
   * `seasonPhase()` flips on, what freezes the rules editor, and what closes
   * the practice round.
   */
  entryClosesAt: string;
  /**
   * Last kickoff of Week 1 — when joining (and removing a member) stops.
   * Migration 0018, and **null until it is applied by hand**, in which case
   * every reader falls back to `entryClosesAt` through `joinClosesAt()` in
   * src/lib/game/season.ts. Never read this field directly.
   */
  joinClosesAt: string | null;
  /** Set once Week 1 picks begin; rules are frozen after this. */
  settingsLockedAt?: string | null;
  /**
   * What the pot costs, in cents (migration 0010), set by an admin through the
   * `set_group_buy_in` RPC. Two numbers rather than one because the account
   * page prints both the total and the breakdown — "$21" over "$20 buy in + $1
   * site fee" — and deriving one from the other either way loses information.
   *
   * Cents, not dollars: an integer cannot drift the way a float does, and
   * `formatMoney` in src/lib/money.ts is the only place that turns it into a
   * string.
   */
  buyInCents: number;
  siteFeeCents: number;
}

export interface HistoryPick {
  week: number;
  teamId: TeamId;
  result: "win" | "loss" | "push";
}

export interface CurrentPick {
  week: number;
  teamId: TeamId;
  /** The game this team plays in this week — drives the per-game lock/reveal. */
  gameId: string;
}

/**
 * Which of a player's runs at the season this is (migration 0017). One person
 * may hold up to two, and they are wholly independent: separate picks, separate
 * strikes, separate elimination, separate dues.
 */
export type EntryNo = 1 | 2;

export interface Member {
  /**
   * The MEMBERSHIP id — `group_members.id`, not the user id.
   *
   * This changed with 0017 and it is the hinge the whole two-entry feature
   * turns on. `toMember` used to set `id: row.user_id` and drop the membership
   * id on the floor, which was harmless while a person was a row; with two
   * entries per person it would make the two indistinguishable to every
   * consumer — one React key for two rows, one bucket in `rankMembers`, one
   * cell in the practice table.
   *
   * So: `id` identifies the ENTRY and is unique across the league, and
   * {@link userId} identifies the PERSON and is not. Anything asking "is this
   * me?" wants `userId`; anything keying, sorting or addressing a row wants
   * `id`. `src/lib/game/score.ts` already wrote by `group_members.id` and so
   * needed no change at all.
   */
  id: string;
  /**
   * The person behind the entry — `group_members.user_id`. Shared by both of a
   * player's entries, so it is never a key; it is how a row recognises its
   * viewer and how the account page groups dues.
   */
  userId: string;
  /** 1 or 2. Reads `row.entry_no ?? 1`, so a pre-0017 database says 1. */
  entryNo: EntryNo;
  /** Pre-formatted "First L." for display and sorting. */
  name: string;
  firstName: string;
  lastName: string;
  /**
   * The animal this player picked, or null when unset or no longer on the list.
   * Drives their avatar everywhere — there is no other avatar source.
   */
  favoriteAnimal: string | null;
  /**
   * Phone number, or null. Null means EITHER unset OR withheld: RLS on
   * profile_private returns rows only to the owner and to admins of the
   * member's leagues, so for everyone else this is null by construction —
   * no client-side gating needed, and none possible.
   */
  phone: string | null;
  role: Role;
  status: MemberStatus;
  /**
   * Losses accrued. Bounded by the group's allowance for a real member row —
   * `computeStatus` stops folding once it eliminates someone — but NOT on the
   * practice standings, where `StandingsClient` merges the preseason tally in and
   * nothing there eliminates, so it counts on past the allowance.
   */
  strikes: number;
  /**
   * Whether the league admin has marked this member's buy-in as paid. Purely
   * informative to the member — only an admin can change it, via the
   * set_member_buy_in RPC.
   */
  buyInPaid: boolean;
  /**
   * When an admin last touched {@link buyInPaid}, either direction. 0010
   * redefined `set_member_buy_in` to stamp it on every change — 0007's `else
   * null` cleared it on unpaid, which made "UNPAID · Updated 10/21"
   * unrenderable. Null means nobody has ever set it.
   */
  buyInPaidAt: string | null;
  /**
   * Whether the preseason practice round exists for this member at all — the
   * weeks in their picker AND their ability to pick one (migration 0011).
   * Admin-set through the set_member_preseason RPC; `group_members` has no
   * UPDATE policy, so there is no other write path.
   *
   * Reads FAIL OPEN (`?? true`): a dropped read or an unapplied 0011 must not
   * take practice away from the whole league.
   */
  showPreseason: boolean;
  eliminatedWeek?: number | null;
  history: HistoryPick[];
  currentPick?: CurrentPick | null;
}

/** Losses tolerated before elimination. */
export function strikeAllowance(type: EliminationType): number {
  return type === "single" ? 1 : 2;
}

/**
 * A team's season win-loss record. Standings data (time-varying, fed from the
 * provider/Postgres in production) — kept out of the static `Team` domain type.
 */
export interface TeamRecord {
  w: number;
  l: number;
  t: number;
}

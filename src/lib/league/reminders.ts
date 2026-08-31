/**
 * Who should be nudged, about what, and what the email says.
 *
 * Pure, for `feed.ts`'s reason: the interesting part of this feature is not
 * sending a message, it is deciding WHICH WEEK a reminder is even about and
 * whether it can still do any good. Those decisions are worth tests, and they
 * can only have tests if they live away from the component and the network.
 *
 * The payload shape comes from `reminder_status_for_admin` (migration 0015),
 * which returns `{ now, season, seasonType, week, pick, buyIn }` as jsonb. `now`
 * is the DATABASE's clock and every age below is measured against it — the send
 * is stamped by Postgres inside `record_reminder_send`, and a browser stamping
 * "now" against it is how "reminded -3 minutes ago" gets printed.
 *
 * Imports here are RELATIVE, not `@/`. There is no vitest.config.ts in this
 * repo, so vitest never reads tsconfig's `paths`, and a `@/` value import
 * resolves under Next and fails under the test runner.
 */

import type { Game } from "../nfl/types";
import { agoLabel } from "./feed";
import { formatLong } from "../time";

export type ReminderKind = "pick" | "buy_in";

/**
 * How soon after a send the admin's button refuses to send again.
 *
 * Unlike the feed's cooldown this is not only politeness to a provider: the
 * cost of a double-tap here is a second email in somebody's inbox. The send log
 * makes that impossible for picks and improbable for buy-ins, so this is the
 * cheap outer guard rather than the guarantee — see 0015 for the guarantee.
 */
export const REMINDER_MANUAL_COOLDOWN_MS = 60_000;

/**
 * How long before a week's first kickoff a pick reminder starts being useful.
 *
 * Without a floor, `reminderWeek` happily returns week 1 in early August and an
 * admin can email the league about a deadline seven weeks out. A week is long
 * enough to cover "the Thursday game is on Thursday" and short enough that the
 * message is about something imminent.
 *
 * This is also why no phase test is needed anywhere in this module: during the
 * preseason `resolveCurrentWeek` returns 1, `reminderWeek` returns 1, and this
 * threshold is what makes the window report `too_early` until the season is
 * genuinely close.
 */
export const PICK_REMINDER_OPENS_MS = 7 * 24 * 60 * 60 * 1000;

/** Mirrors 0015's `p_min_interval` default. Buy-ins are throttled, not keyed. */
export const BUY_IN_REMINDER_MIN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export interface ReminderTarget {
  userId: string;
  firstName: string;
  lastName: string;
  /** Null when this member has never been reminded of this kind. */
  lastSentAt: string | null;
}

export interface ReminderBucket {
  due: ReminderTarget[];
  /** The last send of this kind to ANYONE in the league. Drives the cooldown. */
  lastSentAt: string | null;
}

export interface ReminderSnapshot {
  /** The database's clock at read time. */
  now: string;
  season: number;
  seasonType: string;
  /** Null when no week is currently pickable — see `reminderWeek`. */
  week: number | null;
  pick: ReminderBucket;
  buyIn: ReminderBucket;
}

/**
 * THE WEEK A REMINDER IS ABOUT — which is not the app's "current week".
 *
 * `resolveCurrentWeek` (game/season.ts) returns the greatest week whose EARLIEST
 * kickoff has already passed. That is the right answer for scoring, and the
 * wrong one here, because the two diverge for three days out of every seven:
 * on a Wednesday in October, week 5's Thursday kickoff has not happened, so
 * `currentWeek` is still 4 — and week 4 finished on Monday night.
 *
 * A reminder keyed on `currentWeek` and sent Tuesday or Wednesday would
 * therefore tell the league to pick for a week they cannot pick. Worse, it
 * would consume week 4's row in 0015's unique index, so the genuine week-4
 * reminder could never be sent afterwards. Both halves of that are silent.
 *
 * So: the smallest week at or after `currentWeek` that still has a game which
 * has not kicked off. `>= currentWeek` is a floor rather than a `>` because
 * mid-week — Sunday morning, say — the live week is still pickable and IS the
 * answer. The floor is also what stops a postponed week-3 game rescheduled into
 * December from dragging the answer back to 3 in week 14.
 *
 * Null when nothing is pickable at all: the season is over, or the schedule has
 * not been loaded. Callers render that rather than treating it as an error.
 *
 * Pass REGULAR-SEASON games only. Preseason week 3 and regular week 3 are
 * indistinguishable here, exactly as they are to `resolveWeekFromKickoffs`.
 */
export function reminderWeek(games: Game[], now: Date, currentWeek: number): number | null {
  const nowMs = now.getTime();
  let best: number | null = null;

  for (const g of games) {
    if (g.week < currentWeek) continue;
    if (!isOpen(g, nowMs)) continue;
    if (best === null || g.week < best) best = g.week;
  }

  return best;
}

export type PickWindowReason = "no_games" | "too_early" | "closed" | null;

export interface PickWindow {
  /** May a reminder for this week still do any good? */
  open: boolean;
  reason: PickWindowReason;
  /** The week's last kickoff — the moment a missing pick becomes a loss. */
  lastKickoffIso: string | null;
  /** The next kickoff still ahead, or null once they have all started. */
  nextKickoffIso: string | null;
  /** True once some game has started but others have not. */
  partiallyStarted: boolean;
}

/**
 * Is a pick reminder for `week` still actionable?
 *
 * This is a transcription of 0014's insert/update `with check`, which gates a
 * pick on `g.kickoff > now() and g.status = 'scheduled'`. Reusing the database's
 * own definition matters more than it looks: the obvious alternative — "the
 * week's final kickoff hasn't passed" — holds the window open on a finished week
 * whenever a postponed game keeps a future kickoff, and `weekFinalKickoff` is
 * exactly the value that would tempt someone into writing it.
 *
 * `lastKickoffIso` is still the right thing to PRINT. Picks lock game by game,
 * so the window shrinks continuously: by Sunday evening a member can still pick,
 * but only from the Sunday-night and Monday games. That is worth an email, so
 * the window stays open and the copy says which games are left.
 */
export function weekPickWindow(games: Game[], week: number, now: Date): PickWindow {
  const nowMs = now.getTime();
  const wk = games.filter((g) => g.week === week);

  if (wk.length === 0) {
    return {
      open: false,
      reason: "no_games",
      lastKickoffIso: null,
      nextKickoffIso: null,
      partiallyStarted: false,
    };
  }

  const kickoffs = wk.map((g) => Date.parse(g.kickoff)).filter(Number.isFinite);
  const lastKickoff = kickoffs.length > 0 ? Math.max(...kickoffs) : null;
  const openGames = wk.filter((g) => isOpen(g, nowMs));
  const nextKickoff =
    openGames.length > 0 ? Math.min(...openGames.map((g) => Date.parse(g.kickoff))) : null;

  const lastKickoffIso = lastKickoff === null ? null : new Date(lastKickoff).toISOString();
  const nextKickoffIso = nextKickoff === null ? null : new Date(nextKickoff).toISOString();
  const partiallyStarted = openGames.length > 0 && openGames.length < wk.length;

  if (openGames.length === 0) {
    return { open: false, reason: "closed", lastKickoffIso, nextKickoffIso, partiallyStarted };
  }

  if (nextKickoff !== null && nextKickoff - nowMs > PICK_REMINDER_OPENS_MS) {
    return { open: false, reason: "too_early", lastKickoffIso, nextKickoffIso, partiallyStarted };
  }

  return { open: true, reason: null, lastKickoffIso, nextKickoffIso, partiallyStarted };
}

/**
 * Parse whatever `reminder_status_for_admin` returned.
 *
 * Defensive because the value crosses the PostgREST boundary as `unknown` (the
 * jsonb precedent set by `public_league_snapshot`), and because a database that
 * has not had 0015 applied can return shapes this code has never seen. Anything
 * unrecognisable becomes null, which the caller renders as an unknown state
 * rather than crashing an admin's drawer.
 */
export function mapReminderStatus(raw: unknown): ReminderSnapshot | null {
  if (!isRecord(raw)) return null;
  const now = typeof raw.now === "string" ? raw.now : null;
  if (!now) return null;

  return {
    now,
    season: typeof raw.season === "number" ? raw.season : 0,
    seasonType: typeof raw.seasonType === "string" ? raw.seasonType : "regular",
    week: typeof raw.week === "number" ? raw.week : null,
    pick: mapBucket(raw.pick),
    buyIn: mapBucket(raw.buyIn),
  };
}

function mapBucket(raw: unknown): ReminderBucket {
  if (!isRecord(raw)) return { due: [], lastSentAt: null };
  const due = Array.isArray(raw.due) ? raw.due.map(mapTarget).filter(isTarget) : [];
  return {
    due,
    lastSentAt: typeof raw.lastSentAt === "string" ? raw.lastSentAt : null,
  };
}

function mapTarget(raw: unknown): ReminderTarget | null {
  if (!isRecord(raw)) return null;
  const userId = typeof raw.userId === "string" ? raw.userId : null;
  if (!userId) return null;
  return {
    userId,
    firstName: typeof raw.firstName === "string" ? raw.firstName : "",
    lastName: typeof raw.lastName === "string" ? raw.lastName : "",
    lastSentAt: typeof raw.lastSentAt === "string" ? raw.lastSentAt : null,
  };
}

function isTarget(t: ReminderTarget | null): t is ReminderTarget {
  return t !== null;
}

/**
 * Was the last send of this kind less than `withinMs` ago?
 *
 * Both timestamps come from the SAME Postgres clock — `sent_at` is stamped
 * inside `record_reminder_send` and `now` is returned by
 * `reminder_status_for_admin` — which is what lets this be a plain subtraction.
 *
 * FAILS OPEN, exactly as `feedCheckedRecently` does: nothing sent yet, or an
 * unparseable or future timestamp, is "not recent". The cooldown is the outer
 * courtesy; 0015's unique index is the correctness gate, so a bad value here
 * must not strand an admin behind a minute that never elapses.
 */
export function reminderSentRecently(
  snapshot: ReminderSnapshot | null,
  kind: ReminderKind,
  withinMs: number,
): boolean {
  if (!snapshot) return false;
  const bucket = kind === "pick" ? snapshot.pick : snapshot.buyIn;
  if (!bucket.lastSentAt) return false;
  const age = ageMs(bucket.lastSentAt, snapshot.now);
  if (age === null) return false;
  return age < withinMs;
}

export interface ReminderDescription {
  /** One plain sentence. A co-admin should not need to know what a cron is. */
  headline: string;
  /** The supporting line. May be empty. */
  detail: string;
}

/** The sentence each card prints above its list. */
export function describeReminders(
  snapshot: ReminderSnapshot | null,
  kind: ReminderKind,
  window: PickWindow | null,
): ReminderDescription {
  if (!snapshot) {
    return {
      headline: "Couldn't read who needs a reminder",
      detail: "This needs a database update that hasn't been applied to Supabase yet.",
    };
  }

  const bucket = kind === "pick" ? snapshot.pick : snapshot.buyIn;
  const n = bucket.due.length;
  const last = bucket.lastSentAt
    ? `Last sent ${agoLabel(bucket.lastSentAt, snapshot.now)}.`
    : "None sent yet.";

  if (kind === "buy_in") {
    if (n === 0) return { headline: "Everyone has paid", detail: last };
    return {
      headline: `${n} ${n === 1 ? "player hasn't" : "players haven't"} paid`,
      detail: last,
    };
  }

  if (snapshot.week === null) {
    return {
      headline: "No week is open for picks",
      detail: "Either the season is over or the schedule hasn't been loaded yet.",
    };
  }

  if (window && !window.open) {
    return { headline: `Week ${snapshot.week} — ${closedHeadline(window)}`, detail: last };
  }

  if (n === 0) {
    return { headline: `Everyone has picked for Week ${snapshot.week}`, detail: last };
  }

  return {
    headline: `${n} ${n === 1 ? "player hasn't" : "players haven't"} picked Week ${snapshot.week}`,
    detail: [windowDetail(window), last].filter(Boolean).join(" "),
  };
}

function closedHeadline(window: PickWindow): string {
  if (window.reason === "no_games") return "no games are scheduled";
  if (window.reason === "too_early") return "too early to remind anyone";
  return "picks are closed";
}

function windowDetail(window: PickWindow | null): string {
  if (!window || !window.open) return "";
  if (window.partiallyStarted) {
    return "Some games have already kicked off, so anyone reminded now can only pick from the ones that haven't.";
  }
  return "Every game this week is still open.";
}

export interface MessageInput {
  kind: ReminderKind;
  firstName: string;
  leagueName: string;
  /** Null for a buy-in reminder. */
  week: number | null;
  /** The week's last kickoff, for the deadline line. Null when unknown. */
  deadlineIso: string | null;
  /** True when some of the week's games have already started. */
  partiallyStarted: boolean;
  /** Cents. Only read for a buy-in reminder. */
  buyInCents: number;
  /** Absolute link back into the app. Never relative — this is an email. */
  url: string;
  /**
   * The admin who pressed Send — "the commissioner" in the copy.
   *
   * Whoever acted, not the league's creator: "let them know" has to name the
   * person who just chased you, and with two admins those differ. Resolved
   * server-side in `sendReminders`; the preview passes the viewing admin, who
   * is the same person.
   */
  commissionerFirstName?: string;
  /** The commissioner's own address, for the mailto link. */
  commissionerEmail?: string;
  /**
   * From `profile_private.phone` (0008), which is free text and documented as
   * "never parsed or dialled" — so it is printed verbatim and NOT turned into a
   * `tel:` link. Null or blank simply drops the "or text …" half of the line.
   */
  commissionerPhone?: string | null;
}

/**
 * The subject line.
 *
 * Names the league, because this arrives in an inbox next to everything else in
 * someone's life and "You haven't picked yet" from an unknown sender is spam.
 */
export function reminderSubject(input: MessageInput): string {
  if (input.kind === "buy_in") return `Payment confirmation for ${input.leagueName}`;
  return `${input.leagueName}: you haven't picked for Week ${input.week ?? ""}`.trim();
}

/**
 * Both parts of the body, from one function.
 *
 * ALWAYS send the text part too. An HTML-only message scores badly with spam
 * filters, and the text version is also what the drawer's Preview renders —
 * which is what lets an admin see exactly what will be sent without the panel
 * reaching for `dangerouslySetInnerHTML`.
 *
 * THE DEADLINE IS PRINTED IN US EASTERN, deliberately. Everywhere else in this
 * app `LocalTime` swaps to the reader's own zone after mount; an email has no
 * mount and no JavaScript, so the zone has to be chosen here and named out loud.
 * `formatLong` resolves the abbreviation against the kickoff rather than against
 * `new Date()`, so a December game prints EST and a September one EDT.
 */
export function reminderBody(input: MessageInput): { text: string; html: string } {
  const lines = bodyLines(input);
  const contact = contactLine(input);

  /*
   * The buy-in email carries NO app link, and that is deliberate rather than an
   * omission: its call to action is to pay a person, so a link to a page that
   * only restates the debt competes with the thing you want them to do. The
   * pick reminder keeps its link, because "go and pick" IS a link.
   */
  const link = input.kind === "pick" ? input.url : null;

  const footer = `You're getting this because you're in ${input.leagueName}.`;

  // Blank lines BETWEEN blocks in the text part. The previous version joined
  // every body line with a single newline, so the paragraphs ran together for
  // anyone reading the plain-text alternative — invisible while you only ever
  // look at the HTML one.
  const text = [
    `Hi ${input.firstName || "there"},`,
    ...lines,
    ...(contact ? [contact.text] : []),
    ...(link ? [link] : []),
    footer,
  ].join("\n\n");

  const html = [
    `<p>Hi ${esc(input.firstName || "there")},</p>`,
    ...lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`),
    ...(contact ? [`<p>${contact.html}</p>`] : []),
    ...(link ? [`<p><a href="${esc(link)}">${esc(link)}</a></p>`] : []),
    `<p style="color:#757575;font-size:12px">${esc(footer)}</p>`,
  ].join("\n");

  return { text: `${text}\n`, html };
}

/**
 * "Email or text Alex at 818…" — the one line that is a link rather than prose.
 *
 * It cannot go through `bodyLines`, because that escapes every line into a
 * `<p>`; this needs an anchor in the HTML and a spelled-out address in the text,
 * where no link is possible. Hence two renderings of one sentence.
 *
 * Buy-in only. A pick reminder is answered in the app, not by replying to a
 * person, and the link above already says so.
 *
 * Returns null when there is no commissioner address to link to, so the
 * paragraph is dropped whole rather than rendering "Email  at ." — the caller
 * spreads it conditionally for exactly that reason.
 */
function contactLine(input: MessageInput): { text: string; html: string } | null {
  if (input.kind !== "buy_in") return null;

  const email = (input.commissionerEmail ?? "").trim();
  if (!email) return null;

  const who = (input.commissionerFirstName ?? "").trim() || "the commissioner";
  // Printed verbatim. profile_private.phone is free text and 0008 documents it
  // as "never parsed or dialled", so it is not normalised and not made a `tel:`
  // link — a stored "(818) 312-2718" and a stored "818 312 2718" both read fine.
  const phone = (input.commissionerPhone ?? "").trim();

  // Pre-filling the subject is what makes this a DRAFT rather than a blank
  // compose window — the reply lands with the league already named.
  const href = `mailto:${email}?subject=${encodeURIComponent(`Buy-in for ${input.leagueName}`)}`;

  if (phone) {
    return {
      text: `Email ${who} at ${email}, or text ${phone}.`,
      html: `<a href="${esc(href)}">Email</a> or text ${esc(who)} at ${esc(phone)}.`,
    };
  }

  return {
    text: `Email ${who} at ${email}.`,
    html: `<a href="${esc(href)}">Email ${esc(who)}</a>.`,
  };
}

function bodyLines(input: MessageInput): string[] {
  if (input.kind === "buy_in") {
    // "the commissioner" when we do not know who sent it — the field is
    // optional so a caller that has not wired it through still reads correctly
    // rather than printing "undefined" at somebody.
    const who = (input.commissionerFirstName ?? "").trim() || "the commissioner";
    return [
      `Your buy-in for ${input.leagueName} hasn't been paid yet.${
        input.buyInCents > 0 ? ` The buy-in is ${formatMoney(input.buyInCents)}.` : ""
      } Please pay the commissioner asap or you'll be removed from the league before Week 1 kicks off.`,
      `If you already paid, let ${who} know so they can update your status and keep you in the league.`,
    ];
  }

  const deadline = input.deadlineIso
    ? `The last game of the week kicks off ${formatLong(input.deadlineIso, {
        timeZone: "America/New_York",
      })}.`
    : "";

  return [
    `You haven't made a pick for Week ${input.week} of ${input.leagueName}.`,
    input.partiallyStarted
      ? "Some of this week's games have already started, so you can only pick from the ones that haven't kicked off yet."
      : "Every game this week is still open.",
    deadline,
    "Miss the week entirely and it counts as a loss.",
  ].filter(Boolean);
}

/** "$25" / "$25.50". Whole dollars lose the trailing zeros. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * A game a pick could still be made against.
 *
 * 0014's `with check` in one predicate, and the only definition of "open" in
 * this module. Both `reminderWeek` and `weekPickWindow` route through it so they
 * cannot drift apart.
 */
function isOpen(game: Game, nowMs: number): boolean {
  if (game.status !== "scheduled") return false;
  const k = Date.parse(game.kickoff);
  return Number.isFinite(k) && k > nowMs;
}

/** Milliseconds between two ISO strings, clamped at zero. Null when unparseable. */
function ageMs(fromIso: string, nowIso: string): number | null {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return Math.max(0, now - from);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { SeasonType } from "./types";

/**
 * The week axis: how a week is identified, ordered, and named.
 *
 * A week number alone is ambiguous once the preseason exists — "week 1" is both
 * the Hall of Fame week and the opening Sunday. Everything that has to tell them
 * apart uses a `WeekRef`. Kept pure and dependency-free so the server loader, the
 * client screens, and the scorer all share one vocabulary.
 *
 * This is also the single home for `FINAL_WEEK`, which was previously declared
 * independently in league/load.ts, app/actions.ts, and mock/data.ts, with two
 * more `?? 18` defaults in game/season.ts and game/elimination.ts.
 */

/** Last week of the NFL regular season. */
export const FINAL_WEEK = 18;

/**
 * A week, disambiguated by phase.
 *
 * Note the vocabulary clash this exists to survive: `SeasonPhase` in
 * game/season.ts also has a member called "preseason", but that one means
 * "before this league's Week 1 kickoff (entry still open)" and has nothing to do
 * with NFL preseason football. Here, `seasonType: "pre"` means actual preseason
 * games. The app calls the preseason-football experience "practice" throughout,
 * to keep the two apart.
 */
export interface WeekRef {
  seasonType: SeasonType;
  week: number;
}

export const REGULAR_WEEK = (week: number): WeekRef => ({ seasonType: "regular", week });
export const PRE_WEEK = (week: number): WeekRef => ({ seasonType: "pre", week });

/** Stable string key — safe as a React key, a Map key, or a `<select>` value. */
export function weekKey(ref: WeekRef): string {
  return `${ref.seasonType}:${ref.week}`;
}

/**
 * Inverse of `weekKey`. Returns null on anything malformed — note the explicit
 * emptiness check, because `Number("")` is 0, which is a perfectly valid integer
 * and would otherwise turn "regular:" into week 0.
 */
export function parseWeekKey(key: string): WeekRef | null {
  const [type, rawWeek] = key.split(":");
  if (type !== "pre" && type !== "regular" && type !== "post") return null;
  if (rawWeek === undefined || rawWeek.trim() === "") return null;
  const week = Number(rawWeek);
  if (!Number.isInteger(week) || week < 1) return null;
  return { seasonType: type, week };
}

export function sameWeek(a: WeekRef, b: WeekRef): boolean {
  return a.seasonType === b.seasonType && a.week === b.week;
}

/**
 * How many preseason weeks the loaded schedule actually has. Passed into
 * `weekLabel` because ESPN's preseason numbering is not something we get to
 * assume: depending on the season it either counts the Hall of Fame game as
 * preseason week 1 (pushing the three "real" preseason weeks to 2-4) or it
 * doesn't. Reading it off the data means the labels are right either way,
 * instead of being right for one convention and silently wrong for the other.
 */
export interface WeekLabelOptions {
  /** The highest `week` present among loaded `season_type = 'pre'` games. */
  maxPreWeek?: number;
}

/**
 * Human label for a week — "Week 5", "Preseason 2", "Hall of Fame".
 *
 * When the preseason schedule runs to 4 weeks, week 1 is the Hall of Fame game
 * and weeks 2-4 are Preseason 1-3. When it runs to 3, weeks 1-3 are Preseason
 * 1-3 directly.
 */
export function weekLabel(ref: WeekRef, opts: WeekLabelOptions = {}): string {
  if (ref.seasonType === "post") return postLabel(ref.week);
  if (ref.seasonType === "regular") return `Week ${ref.week}`;

  const maxPreWeek = opts.maxPreWeek ?? 0;
  if (maxPreWeek >= 4) {
    return ref.week <= 1 ? "Hall of Fame" : `Preseason ${ref.week - 1}`;
  }
  return `Preseason ${ref.week}`;
}

function postLabel(week: number): string {
  switch (week) {
    case 1:
      return "Wild Card";
    case 2:
      return "Divisional";
    case 3:
      return "Conference";
    case 5:
      return "Super Bowl";
    default:
      return `Postseason ${week}`;
  }
}

/** Short form for a narrow column header — "5", "P2", "HOF". */
export function weekShortLabel(ref: WeekRef, opts: WeekLabelOptions = {}): string {
  if (ref.seasonType !== "pre") return String(ref.week);
  const maxPreWeek = opts.maxPreWeek ?? 0;
  if (maxPreWeek >= 4) return ref.week <= 1 ? "HOF" : `P${ref.week - 1}`;
  return `P${ref.week}`;
}

export interface WeekOption {
  ref: WeekRef;
  /** `weekKey(ref)` — the selected value, and a stable React key. */
  key: string;
  /** Full name — "Week 5", "Preseason 2". The chip's accessible name. */
  label: string;
  /**
   * What a 50px chip prints: "01".."18" for the regular season, and
   * `weekShortLabel`'s "HOF"/"P1" for the preseason.
   *
   * Zero-padded because the strip is a row of fixed-width squares and a
   * single-digit "1" sits visibly narrower than "10" beside it. Derived here
   * rather than in the component so it unit-tests without a component-test
   * stack — the same reason `label` lives here.
   */
  chipLabel: string;
  /**
   * True for the one live week in the whole list — the week the NFL is actually
   * in. Deliberately not per-phase: marking each group's own live week put
   * "· current" on two options at once during the preseason, which reads as a
   * contradiction rather than as a phase distinction.
   *
   * Note this is a *label*, not a permission. Regular Week 1 picks are open all
   * through the preseason (see `liveRef` in MyPicksClient); the marker only says
   * which week is being played right now.
   */
  isCurrent: boolean;
}

export interface WeekStripOptionsInput {
  /** Live regular-season week — the one option that carries `isCurrent`. */
  currentWeek: number;
  finalWeek?: number;
  /**
   * Preseason weeks to offer, and which of them is live. Omit once practice is
   * over — the preseason chips then disappear, which is how preseason leaves the
   * UI at Week 1 without anything being deleted.
   */
  practice?: { weeks: number[]; currentWeek: number } | null;
}

/**
 * The week strip's model: preseason chips (while practice is live) followed by
 * the WHOLE regular season, 1 → finalWeek.
 *
 * The list this replaced was deliberately forward-only, on the grounds that a
 * member cannot browse to a week they have already played. The strip drops that
 * rule, because it draws a played week as the team you spent there — a state
 * that could never appear in a list starting at the current week, since a pick
 * only ever exists for the current week or earlier. Past weeks are previews:
 * `MyPicksClient` already refuses to write to any week that isn't live, and the
 * server re-derives the week regardless of what the client sends.
 *
 * Flat rather than grouped, because a row of equal squares has nowhere to put an
 * `<optgroup>` heading. The phase distinction survives in `chipLabel` instead —
 * preseason chips read "HOF"/"P1", regular ones "01".
 *
 * Exactly one option in the list carries `isCurrent`, and while practice is live
 * it is one of the preseason's.
 */
export function weekStripOptions(input: WeekStripOptionsInput): WeekOption[] {
  const finalWeek = input.finalWeek ?? FINAL_WEEK;
  const options: WeekOption[] = [];

  // Whether the preseason is actually being offered, which is the same thing as
  // "the preseason is the phase being played" — it is the presence of a practice
  // slate that puts those chips on screen, and its absence that retires them at
  // Week 1. So it also decides which phase owns the "current" marker.
  const practice = input.practice;
  const practising = practice != null && practice.weeks.length > 0;

  if (practising) {
    const maxPreWeek = Math.max(...practice.weeks);
    for (const week of [...practice.weeks].sort((a, b) => a - b)) {
      const ref = PRE_WEEK(week);
      options.push({
        ref,
        key: weekKey(ref),
        label: weekLabel(ref, { maxPreWeek }),
        chipLabel: weekShortLabel(ref, { maxPreWeek }),
        isCurrent: week === practice.currentWeek,
      });
    }
  }

  // Clamped for the marker only, never for the range: the strip always offers
  // the full season, but a `currentWeek` outside it must still leave exactly one
  // chip marked rather than none.
  const liveWeek = Math.min(Math.max(input.currentWeek, 1), finalWeek);
  for (let week = 1; week <= finalWeek; week += 1) {
    const ref = REGULAR_WEEK(week);
    options.push({
      ref,
      key: weekKey(ref),
      label: weekLabel(ref),
      chipLabel: String(week).padStart(2, "0"),
      // Not marked while practice is live: the regular season hasn't started, so
      // Week 1 is the next week, not the current one.
      isCurrent: !practising && week === liveWeek,
    });
  }

  return options;
}

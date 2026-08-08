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
  /** `weekKey(ref)` — the `<option value>`. */
  key: string;
  label: string;
  /** True for the live week of its own phase. */
  isCurrent: boolean;
}

export interface WeekOptionGroup {
  /** `<optgroup label>`; null for an ungrouped list. */
  label: string | null;
  options: WeekOption[];
}

export interface GroupedWeekOptionsInput {
  /** Live regular-season week. Regular options run from here to `finalWeek`. */
  currentWeek: number;
  finalWeek?: number;
  /**
   * Preseason weeks to offer, and which of them is live. Omit once practice is
   * over — the whole "Preseason" group then disappears, which is how preseason
   * leaves the UI at Week 1 without anything being deleted.
   */
  practice?: { weeks: number[]; currentWeek: number } | null;
}

/**
 * The dropdown model: an optional "Preseason" group followed by "Regular
 * Season". Regular weeks stay forward-only (current → final), matching the
 * existing behaviour — a member cannot browse to a week they have already played.
 */
export function groupedWeekOptions(input: GroupedWeekOptionsInput): WeekOptionGroup[] {
  const finalWeek = input.finalWeek ?? FINAL_WEEK;
  const groups: WeekOptionGroup[] = [];

  const practice = input.practice;
  if (practice && practice.weeks.length > 0) {
    const maxPreWeek = Math.max(...practice.weeks);
    groups.push({
      label: "Preseason",
      options: [...practice.weeks]
        .sort((a, b) => a - b)
        .map((week) => {
          const ref = PRE_WEEK(week);
          return {
            ref,
            key: weekKey(ref),
            label: weekLabel(ref, { maxPreWeek }),
            isCurrent: week === practice.currentWeek,
          };
        }),
    });
  }

  const from = Math.min(Math.max(input.currentWeek, 1), finalWeek);
  const regular: WeekOption[] = [];
  for (let week = from; week <= finalWeek; week += 1) {
    const ref = REGULAR_WEEK(week);
    regular.push({
      ref,
      key: weekKey(ref),
      label: weekLabel(ref),
      isCurrent: week === input.currentWeek,
    });
  }
  groups.push({ label: groups.length > 0 ? "Regular Season" : null, options: regular });

  return groups;
}

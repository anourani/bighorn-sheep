/**
 * Time formatting. All kickoff times and deadlines are shown in the viewer's
 * local timezone (PRD requirement). Every function accepts an optional
 * `timeZone` so server rendering can be deterministic and the client can swap
 * to the browser zone after mount (see <LocalTime/>).
 */

type FmtOpts = { timeZone?: string };

export function formatClock(iso: string, opts: FmtOpts = {}): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: opts.timeZone,
  });
}

export function formatDayClock(iso: string, opts: FmtOpts = {}): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", timeZone: opts.timeZone });
  return `${day} ${formatClock(iso, opts)}`;
}

/** The date half of a kickoff on its own — "Sun, Sep 13". */
export function formatDate(iso: string, opts: FmtOpts = {}): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: opts.timeZone,
  });
}

/**
 * The clock with its zone — "4:00 PM EST".
 *
 * Separate from `formatClock` rather than an option on it: the zone is only
 * worth the width where the line stands alone as the whole kickoff (the picks
 * hero), and every other caller sits next to a date that already establishes it.
 */
export function formatClockZone(iso: string, opts: FmtOpts = {}): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: opts.timeZone,
  });
}

export function formatFull(iso: string, opts: FmtOpts = {}): string {
  return `${formatDate(iso, opts)} · ${formatClock(iso, opts)}`;
}

/**
 * The unabbreviated kickoff line — "Saturday, March 21st at 7:30 PM EDT".
 *
 * Pinned to en-US rather than the viewer's locale, unlike everything above.
 * The ordinal suffix ("st", "nd", "rd", "th") is an English construction, so
 * honouring the browser locale would emit mongrels like "Samstag, März 21st".
 * The *zone* is still the viewer's — only the wording is fixed.
 *
 * Built from `formatToParts` so the suffix can be appended to the day number
 * without string surgery on an already-assembled date: the day is a labelled
 * part, and en-US supplies ", " and " at " as its own literals.
 *
 * The zone abbreviation is resolved against the kickoff itself, not against
 * `new Date()` as `timeZoneLabel()` does, so an EST game read in August says
 * EST rather than picking up today's daylight offset.
 */
export function formatLong(iso: string, opts: FmtOpts = {}): string {
  return ordinalDate(iso, opts, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * "Wednesday, September" + an ordinal day, plus whatever `extra` asks for.
 *
 * The shared body of the two ordinal formatters. `timeZone` is spread LAST so
 * `extra` cannot shadow it — a caller passing one would otherwise silently
 * format in the wrong zone.
 *
 * A bad timestamp makes toLocaleDateString say "Invalid Date", but makes
 * formatToParts THROW — and one unparseable kickoff should not take the whole
 * picks page down with it. Same backstop reasoning as the unknown-team row.
 */
function ordinalDate(
  iso: string,
  opts: FmtOpts,
  extra: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...extra,
    timeZone: opts.timeZone,
  })
    .formatToParts(d)
    .map((p) => (p.type === "day" ? `${p.value}${ordinalSuffix(Number(p.value))}` : p.value))
    .join("");
}

/** "st" / "nd" / "rd" / "th" for a day of the month. 11-13 are the exceptions. */
function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * A numeric date with its clock — "10/21, 2:47 PM".
 *
 * For an audit stamp: when an admin last moved someone's buy-in flag, printed
 * both on the admin roster and on that member's own account card.
 *
 * It carries the TIME, and that is the entire point. This used to be
 * `formatMonthDay`, which emitted "10/21" and nothing else — so an admin who
 * toggled a switch off and back on the same afternoon watched the stamp beside
 * it not move, because both writes formatted to the same six characters. The
 * database was correct and the refresh was correct; the format was throwing the
 * change away. A stamp that cannot show a same-day change is not a stamp.
 *
 * Not {@link formatFull}, which is "Sun, Sep 13 · 4:00 PM": its weekday is
 * padding here, and its `·` separator collides with the surrounding copy, which
 * already reads "Paid · …".
 *
 * Pinned to en-US and returning "" on a bad value, for the reasons
 * {@link formatWeekdayDate} gives below — month-first is the form the design
 * shows, and a broken column value should drop the line rather than shout
 * "Invalid Date" at a user.
 */
export function formatMonthDayClock(iso: string, opts: FmtOpts = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: opts.timeZone,
  });
}

/**
 * A date with its weekday, no clock — "Sunday, August 15".
 *
 * For the buy-in card's deadline sentence, which reads "Anyone who doesn't pay
 * by ___ will be removed from the league". {@link formatLong} is the wrong tool
 * there: it appends an ordinal and a time ("Sunday, August 15th at 1:00 PM
 * EDT"), which is right for a kickoff and reads as false precision for a
 * money deadline. {@link formatWeekdayDateOrdinal} is the one that DOES carry
 * the ordinal, for the invite card — if you came here looking for "9th", that
 * is the neighbour you want, and adding one here would break a test.
 *
 * en-US and "" on a bad value, for the same reasons as {@link formatMonthDayClock}.
 */
export function formatWeekdayDate(iso: string, opts: FmtOpts = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: opts.timeZone,
  });
}

/**
 * A date with its weekday and an ordinal day, no clock — "Wednesday, September
 * 9th".
 *
 * The invite card's deadline line, where the date is the headline of the module
 * and the kickoff time is not shown at all.
 *
 * A third formatter rather than an option on either neighbour, because both
 * neighbours are deliberately what they are. {@link formatLong} appends the
 * time and zone, which is right for a kickoff. {@link formatWeekdayDate} omits
 * the ordinal ON PURPOSE — its docblock argues an ordinal reads as false
 * precision on the buy-in card, and there is a test pinning that the two differ.
 * So "just add an ordinal to formatWeekdayDate" breaks a guard written to catch
 * exactly that edit.
 *
 * Shares {@link ordinalDate} with {@link formatLong}, so the two can only ever
 * differ by the clock — there is a test asserting exactly that.
 */
export function formatWeekdayDateOrdinal(iso: string, opts: FmtOpts = {}): string {
  return ordinalDate(iso, opts, {});
}

export function weekdayShort(iso: string, opts: FmtOpts = {}): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { weekday: "short", timeZone: opts.timeZone })
    .toUpperCase();
}

export function timeZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export interface Countdown {
  done: boolean;
  label: string;
}

/** Compact countdown like "2d 4h", "3h 12m", "8m", or "now". */
export function countdown(target: Date, now: Date): Countdown {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return { done: true, label: "now" };
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return { done: false, label: `${days}d ${hours}h` };
  if (hours > 0) return { done: false, label: `${hours}h ${minutes}m` };
  return { done: false, label: `${minutes}m` };
}

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
  const d = new Date(iso);
  // A bad timestamp makes toLocaleDateString say "Invalid Date", but makes
  // formatToParts throw — and one unparseable kickoff should not take the whole
  // picks page down with it. Same backstop reasoning as the unknown-team row.
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
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

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

export function formatFull(iso: string, opts: FmtOpts = {}): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: opts.timeZone,
  });
  return `${date} · ${formatClock(iso, opts)}`;
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

"use client";

import { useEffect, useState } from "react";
import {
  formatClock,
  formatClockZone,
  formatDate,
  formatDayClock,
  formatFull,
  formatLong,
  formatMonthDay,
  formatWeekdayDate,
} from "@/lib/time";

type Mode =
  | "clock"
  | "clockzone"
  | "date"
  | "dayclock"
  | "full"
  | "long"
  | "monthday"
  | "weekdaydate";

function format(iso: string, mode: Mode, timeZone?: string): string {
  const opts = { timeZone };
  if (mode === "clock") return formatClock(iso, opts);
  if (mode === "clockzone") return formatClockZone(iso, opts);
  if (mode === "date") return formatDate(iso, opts);
  if (mode === "full") return formatFull(iso, opts);
  if (mode === "long") return formatLong(iso, opts);
  if (mode === "monthday") return formatMonthDay(iso, opts);
  if (mode === "weekdaydate") return formatWeekdayDate(iso, opts);
  return formatDayClock(iso, opts);
}

/**
 * Renders a kickoff/deadline in the viewer's local timezone. To avoid an SSR
 * hydration mismatch we render a deterministic US-Eastern string on the server
 * and swap to the true local zone after mount.
 */
export function LocalTime({
  iso,
  mode = "dayclock",
  className,
}: {
  iso: string;
  mode?: Mode;
  className?: string;
}) {
  const [text, setText] = useState(() => format(iso, mode, "America/New_York"));
  useEffect(() => {
    setText(format(iso, mode));
  }, [iso, mode]);
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {text}
    </time>
  );
}

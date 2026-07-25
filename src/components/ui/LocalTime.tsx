"use client";

import { useEffect, useState } from "react";
import { formatClock, formatDayClock, formatFull } from "@/lib/time";

type Mode = "clock" | "dayclock" | "full";

function format(iso: string, mode: Mode, timeZone?: string): string {
  const opts = { timeZone };
  if (mode === "clock") return formatClock(iso, opts);
  if (mode === "full") return formatFull(iso, opts);
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

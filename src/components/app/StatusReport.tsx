import { cn } from "@/lib/cn";
import { SurvivorStrip } from "@/components/app/SurvivorStrip";
import { statusLine, type StatusLineInput } from "@/lib/league/view";

/**
 * "Week 6 Status Report · 29 survivors. 15 deaths." over the survivor strip.
 *
 * Shared by the landing page and the signed-in standings page — same data, same
 * `statusLine()` strings, one column: a label line, then the strip in its own
 * rule-bounded band. It lives in `app/` rather than `landing/` for the reason
 * `SurvivorStrip` does: the landing page is the borrower here, and a signed-out
 * page must not reach into a folder that may import server-only league loading.
 *
 * Carries no padding of its own because its two hosts space it differently (the
 * landing page's own rhythm vs. the app shell's `main`, which already supplies
 * the horizontal inset) — each passes its own via `className`.
 *
 * "Status Report" is composed here rather than folded into `statusLine()`,
 * because it's this section's own chrome: the same strings appear without it
 * wherever a bare "Week 6" is what's wanted.
 */
export function StatusReport({
  status,
  className,
}: {
  status: StatusLineInput;
  className?: string;
}) {
  const { lead, primary, secondary } = statusLine(status);

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold leading-[1.2] text-shell-ink">
          {lead} Status Report
        </span>
        <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.2]">
          {/* This line used to be #000000 against #1E1E1E beside it, flagged
              here as probably unintentional. The design has since settled both
              on #1E1E1E and the muted half on #757575, in the desktop and
              mobile variants alike, so they now use the shell tokens. */}
          <span className="text-shell-ink">{primary}</span>
          <span className="text-shell-mute">{secondary}</span>
        </div>
      </div>

      {/* 6px of breathing room inside the rules on a phone, 8px above it — the
          only measurement the two variants of this tile disagree on, besides
          the strip's own gap. */}
      <div className="border-y border-shell-line py-1.5 sm:py-2">
        <SurvivorStrip status={status} />
      </div>
    </section>
  );
}

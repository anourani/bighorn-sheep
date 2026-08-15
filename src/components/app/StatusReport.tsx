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
          {/* The design gives this #000000 while the line beside it is #1E1E1E —
              two near-identical blacks, almost certainly unintentional.
              Transcribed as given and flagged, per this repo's habit of noting
              spec oddities rather than silently normalising them. */}
          <span className="text-black">{primary}</span>
          <span className="text-shell-soft">{secondary}</span>
        </div>
      </div>

      <div className="border-y border-shell-line py-2">
        <SurvivorStrip status={status} />
      </div>
    </section>
  );
}

import { SurvivorStrip } from "@/components/app/SurvivorStrip";
import { statusLine, type StatusLineInput } from "@/lib/league/view";

/**
 * "Week 6 Status Report · 29 survivors. 15 deaths." over the survivor strip.
 *
 * Not `LeagueStatusBarView`, despite the shared vocabulary. That one is a row —
 * a two-line text block with the strip beside it — because it lives in a 68px
 * band under the app header. This is a column: one label line, strip below, in
 * its own rule-bounded band. Same data, same `statusLine()` strings, different
 * shape; they share `SurvivorStrip` and nothing else.
 *
 * "Status Report" is composed here rather than folded into `statusLine()`,
 * because it's landing-page chrome — the app's bar must keep reading just
 * "Week 6".
 */
export function StatusReport({ status }: { status: StatusLineInput }) {
  const { lead, primary, secondary } = statusLine(status);

  return (
    <section className="flex flex-col gap-2 px-4 py-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold leading-[1.2] text-shell-ink">
          {lead} Status Report
        </span>
        <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.2]">
          {/* The design gives this #000000 while the line beside it is #1E1E1E —
              two near-identical blacks, almost certainly unintentional.
              Transcribed as given and flagged, matching LeagueStatusBarView. */}
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

import { cn } from "@/lib/cn";
import { SurvivorStrip } from "@/components/app/SurvivorStrip";
import { statusLine, type StatusLineInput } from "@/lib/league/view";

/**
 * "Week 6 Status Report · 29 survivors. 15 deaths." over the survivor strip.
 *
 * Shared by the landing page and the signed-in standings page — same data, same
 * `statusLine()` strings, one column: a label line, then the strip. It lives in
 * `app/` rather than `landing/` for the reason `SurvivorStrip` does: the landing
 * page is the borrower here, and a signed-out page must not reach into a folder
 * that may import server-only league loading.
 *
 * Carries no *vertical* padding of its own because its two hosts space it
 * differently (the landing page's own rhythm vs. the app shell's `main`) — each
 * passes its own via `className`.
 *
 * Horizontally it is the other way round, and this is the one thing a third host
 * would trip over: below `lg` the strip runs edge to edge while the label stays
 * inset, and it gets there by cancelling the host's inset with `-mx-4`. That
 * assumes every host supplies exactly 16px of it. Both do today — the landing
 * page passes `px-4`, and the app shell's `main` has it (src/app/app/layout.tsx).
 * A host with any other inset will bleed by the wrong amount.
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
  const { lead, leadShort, primary, secondary } = statusLine(status);

  return (
    <section className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold leading-[1.2] text-shell-ink">
          {/* "W6 Status Report" on a phone, "Week 6 Status Report" from `sm`.
              Two spans because no CSS swaps the text inside one, and this pair
              is the form that doesn't cost anything in the accessibility tree:
              the abbreviation is `aria-hidden`, and the full string is only ever
              *visually* hidden (`sr-only`), so a screen reader reads "Week 6"
              once at every width. Reversing that — `hidden` on the long form —
              would drop it from the tree entirely below `sm`. */}
          <span className="sm:hidden" aria-hidden>
            {leadShort}
          </span>
          <span className="max-sm:sr-only">{lead}</span> Status Report
        </span>
        {/* 1.35 rather than the heading's 1.2: this is the taller of the two
            line boxes, so it alone sets the label row's height — 19px, which is
            what lands the whole tile on the mock's 71px (phone) / 87px. */}
        <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.35]">
          {/* This line used to be #000000 against #1E1E1E beside it, flagged
              here as probably unintentional. The design has since settled both
              on #1E1E1E and the muted half on #757575, in the desktop and
              mobile variants alike, so they now use the shell tokens. */}
          <span className="text-shell-ink">{primary}</span>
          <span className="text-shell-mute">{secondary}</span>
        </div>
      </div>

      {/* The strip used to sit in a band bounded by two hairlines. The design
          has dropped both rules and the padding they needed; the strip now runs
          straight under the label, and below `lg` it spans the full viewport by
          cancelling the host's 16px inset (see the note above the component).
          `-mx-4` inside a `px-4` parent resolves to exactly that parent's
          border box, so this cannot overflow horizontally. */}
      <div className="-mx-4 lg:mx-0">
        <SurvivorStrip status={status} />
      </div>
    </section>
  );
}

import { cn } from "@/lib/cn";
import type { StatusLineInput } from "@/lib/league/view";

/**
 * One cell per member, eliminated first: grey for the dead, orange for the
 * living, sized proportionally so the ratio is readable at a glance.
 *
 * Its own module rather than an export from whichever section draws it, so a
 * signed-out landing page never risks pulling server-only league loading in to
 * draw a row of rectangles.
 */
export function SurvivorStrip({
  status,
  className,
}: {
  status: StatusLineInput;
  className?: string;
}) {
  const eliminated = status.kind === "season" ? status.eliminated : 0;
  const alive = status.kind === "season" ? status.alive : status.joined;
  const label =
    status.kind === "season"
      ? `${alive} of ${alive + eliminated} players still alive, ${eliminated} eliminated`
      : `${alive} players joined, all alive`;

  /*
    Known limit, pre-existing and deliberately not fixed here: given the
    surrounding padding, gaps and text block, cells fall below 1 CSS pixel at
    roughly 59 members at 390px (262 at 1000px), and past ~87 on a phone the
    gaps consume the whole track. The fix, recorded so it isn't re-derived: a
    pure `survivorStrip(alive, eliminated, { maxCells })` in view.ts returning
    per-member cells below a ~48 threshold and a two-segment proportional bar
    above it, which preserves the ratio — the only information left at 1px.
  */
  return (
    // 1px between cells on a phone, 2px from `sm` up: at 393px the wider gap
    // eats enough of the track to visibly distort the alive/dead ratio, which
    // is the only thing this strip is for.
    <div className={cn("flex items-center gap-px sm:gap-0.5", className)} role="img" aria-label={label}>
      {Array.from({ length: eliminated }).map((_, i) => (
        <span key={`out-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-shell-line" />
      ))}
      {Array.from({ length: alive }).map((_, i) => (
        <span key={`alive-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-accent" />
      ))}
    </div>
  );
}

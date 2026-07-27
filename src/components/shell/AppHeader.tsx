import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { CURRENT_WEEK, GROUP, MEMBERS, SEASON } from "@/lib/mock/data";

/**
 * The app shell header — two stacked bars.
 *
 *  1. A minimized global bar: the brand mark + league name + season range. No
 *     week/live pills; the top bar is now identity-only.
 *  2. A survivor-status bar: the current week, a "N survivors · N deaths" tally,
 *     and a proportional strip of cells — one per member — that reads the pool at
 *     a glance. Gray cells are the eliminated; orange cells are the survivors
 *     still in it. Eliminated cells lead so the orange "field" grows from the
 *     right as the season narrows.
 */
export function AppHeader() {
  const survivors = MEMBERS.filter((m) => m.status === "alive").length;
  const deaths = MEMBERS.filter((m) => m.status === "eliminated").length;
  const total = survivors + deaths;
  const seasonLabel = `${SEASON}-${SEASON + 1}`;

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
      {/* Bar 1 — minimized global header: brand identity only. */}
      <div className="border-b border-line px-4 pb-3 pt-4">
        <Link
          href="/app"
          className="inline-flex items-center gap-3 rounded-control"
          aria-label={`${GROUP.name} — home`}
        >
          <BrandMark size="md" />
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold leading-[1.2] tracking-tight text-ink">
              {GROUP.name}
            </span>
            <span className="text-xs font-medium leading-[1.1] text-ink-mute">{seasonLabel}</span>
          </span>
        </Link>
      </div>

      {/* Bar 2 — survivor status: week, tally, and the per-member strip. */}
      <div className="flex items-center gap-6 border-b border-line px-4 py-2">
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-sm font-medium leading-[1.2] text-ink">Week {CURRENT_WEEK}</span>
          <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.2]">
            <span className="text-[#B35838]">
              {survivors} {survivors === 1 ? "survivor" : "survivors"}.
            </span>
            <span className="text-ink-mute">
              {deaths} {deaths === 1 ? "death" : "deaths"}.
            </span>
          </div>
        </div>

        <div
          className="flex flex-1 items-center gap-0.5"
          role="img"
          aria-label={`${survivors} of ${total} players still alive, ${deaths} eliminated`}
        >
          {Array.from({ length: deaths }).map((_, i) => (
            <span key={`out-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-[#D9D9D9]" />
          ))}
          {Array.from({ length: survivors }).map((_, i) => (
            <span key={`alive-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-[#FC855C]" />
          ))}
        </div>
      </div>
    </header>
  );
}

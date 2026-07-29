import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { loadLeague } from "@/lib/league/load";
import { countdown } from "@/lib/time";

/**
 * The app shell header — two stacked bars, driven by the viewer's live league.
 *
 *  1. A minimized global bar: the brand mark + league name + season range.
 *  2. A survivor-status bar: the current week, a "N survivors · N deaths" tally,
 *     and a proportional strip of cells — one per member (gray = eliminated,
 *     orange = alive). Pre-season shows a countdown to kickoff + who's joined.
 *
 * Server Component: it shares the request-memoized `loadLeague()` with the page
 * body, so this costs no extra round-trip. A player in no league yet gets a
 * minimal identity-only header.
 */
export async function AppHeader() {
  const load = await loadLeague();

  if (load.kind !== "ok") return <MinimalHeader />;

  const { group, members, currentWeek, phase } = load.data;
  const now = new Date(load.data.nowIso);

  const survivors = members.filter((m) => m.status === "alive").length;
  const deaths = members.filter((m) => m.status === "eliminated").length;
  const total = survivors + deaths;
  const seasonLabel = `${group.season}-${group.season + 1}`;

  const isPreseason = phase === "preseason";
  const startsIn = countdown(new Date(group.entryClosesAt), now);
  const joined = members.length;

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
      {/* Bar 1 — minimized global header: brand identity only. */}
      <div className="border-b border-line px-4 pb-3 pt-4">
        <Link
          href="/app"
          className="inline-flex items-center gap-3 rounded-control"
          aria-label={`${group.name} — home`}
        >
          <BrandMark size="md" />
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold leading-[1.2] tracking-tight text-ink">
              {group.name}
            </span>
            <span className="text-xs font-medium leading-[1.1] text-ink-mute">{seasonLabel}</span>
          </span>
        </Link>
      </div>

      {/* Bar 2 — status. In-season: survivor tally + per-member strip. Pre-season:
          a countdown to kickoff + how many have joined so far. */}
      {isPreseason ? (
        <div className="flex items-center gap-6 border-b border-line px-4 py-2">
          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-sm font-medium leading-[1.2] text-ink">Pre-season</span>
            <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.2]">
              <span className="text-[#B35838]">Starts in {startsIn.label}.</span>
              <span className="text-ink-mute">
                {joined} {joined === 1 ? "joined" : "joined"}.
              </span>
            </div>
          </div>

          <div
            className="flex flex-1 items-center gap-0.5"
            role="img"
            aria-label={`${joined} players joined, all alive`}
          >
            {Array.from({ length: joined }).map((_, i) => (
              <span key={`in-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-[#FC855C]" />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-6 border-b border-line px-4 py-2">
          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-sm font-medium leading-[1.2] text-ink">Week {currentWeek}</span>
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
      )}
    </header>
  );
}

/** Identity-only header for a signed-in player who isn't in a league yet. */
function MinimalHeader() {
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
      <div className="border-b border-line px-4 pb-3 pt-4">
        <Link href="/app" className="inline-flex items-center gap-3 rounded-control" aria-label="Last Man Standing — home">
          <BrandMark size="md" />
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold leading-[1.2] tracking-tight text-ink">
              Last Man Standing
            </span>
            <span className="text-xs font-medium leading-[1.1] text-ink-mute">NFL Survival League</span>
          </span>
        </Link>
      </div>
    </header>
  );
}

import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { CURRENT_WEEK, GROUP, SEASON, WEEK_GAMES } from "@/lib/mock/data";

export function AppHeader() {
  const liveCount = (WEEK_GAMES[CURRENT_WEEK] ?? []).filter((g) => g.status === "in_progress").length;

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-shell items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-control py-1" aria-label="My Picks — home">
          <BrandMark />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-semibold tracking-tight text-ink">{GROUP.name}</span>
            <MonoLabel className="mt-1 text-ink-mute">Season {SEASON}</MonoLabel>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {liveCount > 0 ? (
            <Pill variant="live" live>
              {liveCount} Live
            </Pill>
          ) : null}
          <span className="rounded-pill border border-line bg-white px-2.5 py-1 font-mono text-label-sm uppercase text-ink-soft">
            Wk {CURRENT_WEEK}
          </span>
        </div>
      </div>
    </header>
  );
}

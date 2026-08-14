"use client";

import { useMemo } from "react";
import { LockIcon } from "@/components/icons";
import { StandingsGrid } from "@/components/group/StandingsGrid";
import { buildGameIndex } from "@/lib/league/games";
import { rankMembers } from "@/lib/league/view";
import type { PublicLeagueData } from "@/lib/league/public";

/**
 * The standings table on the landing page — the same `StandingsGrid` the
 * signed-in app renders, unchanged.
 *
 * This wrapper exists for one reason: `gameForTeam` is a function, so it cannot
 * cross the RSC boundary. `PublicLeagueData` is fully serializable (no
 * functions, no `Date`), and the index is rebuilt here. Exactly what
 * `StandingsClient` does for /app.
 *
 * `viewerId=""` never matches a membership uuid, so no row gets the "you"
 * highlight or the left brand border — right for a stranger, who is nobody in
 * this league.
 */
export function PublicStandings({ data }: { data: PublicLeagueData }) {
  const now = useMemo(() => new Date(data.nowIso), [data.nowIso]);
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const ranked = useMemo(() => rankMembers(data.members), [data.members]);

  return (
    <div className="space-y-2">
      <StandingsGrid
        ranked={ranked}
        viewerId=""
        currentWeek={data.currentWeek}
        finalWeek={data.finalWeek}
        rules={data.rules}
        now={now}
        gameForTeam={idx.gameForTeam}
        hiddenPickUserIds={data.hiddenPickUserIds}
      />
      {/* Carried over from StandingsClient. It matters more here: a visitor who
          has never seen the app has no other way to read a padlock. */}
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-mute">
        <LockIcon className="h-3.5 w-3.5 shrink-0" />
        Current-week picks stay hidden until each team&apos;s game kicks off.
      </p>
    </div>
  );
}

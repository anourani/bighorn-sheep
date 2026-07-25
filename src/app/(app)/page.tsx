"use client";

import { useMemo, useState } from "react";
import { PickStatusHeader } from "@/components/picks/PickStatusHeader";
import { WeekSchedule } from "@/components/picks/WeekSchedule";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { ChevronDownIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import {
  BYES_BY_WEEK,
  CURRENT_WEEK,
  DEMO_NOW,
  FINAL_WEEK,
  GROUP,
  WEEK_GAMES,
  gameForTeam,
  weekFinalKickoff,
  you,
} from "@/lib/mock/data";
import type { HistoryPick } from "@/lib/league/types";

export default function MyPicksPage() {
  const me = you();
  const now = DEMO_NOW;
  const rules = GROUP.rules;

  const [viewWeek, setViewWeek] = useState(CURRENT_WEEK);
  const [pickTeam, setPickTeam] = useState<TeamId | null>(me.currentPick?.teamId ?? null);

  const isCurrent = viewWeek === CURRENT_WEEK;
  const games = WEEK_GAMES[viewWeek] ?? [];
  const byes = BYES_BY_WEEK[viewWeek] ?? [];

  // Teams already spent this season — burned for every week, so they stay
  // flagged even while browsing ahead ("plan which teams to save").
  const usedByTeam = useMemo(
    () => new Map<TeamId, HistoryPick>(me.history.map((h) => [h.teamId, h])),
    [me.history],
  );

  // The pick always reflects the current week — you can only pick for it.
  const pickGame = pickTeam ? gameForTeam(CURRENT_WEEK, pickTeam) : undefined;

  const weekOptions = useMemo(
    () => Array.from({ length: FINAL_WEEK - CURRENT_WEEK + 1 }, (_, i) => CURRENT_WEEK + i),
    [],
  );

  return (
    <div className="stagger space-y-4">
      <PickStatusHeader
        member={me}
        rules={rules}
        week={CURRENT_WEEK}
        teamId={pickTeam}
        game={pickGame}
        now={now}
        weekFinalKickoff={weekFinalKickoff(CURRENT_WEEK)}
      />

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <MonoLabel className="text-ink-mute">Week {viewWeek}</MonoLabel>
            <h2 className="mt-0.5 text-sm font-semibold text-ink">Schedule</h2>
          </div>

          <label className="block">
            <MonoLabel className="mb-1.5 block text-ink-mute">Change week</MonoLabel>
            <div className="relative">
              <select
                value={viewWeek}
                onChange={(e) => setViewWeek(Number(e.target.value))}
                className="w-full min-w-[9.5rem] appearance-none rounded-control border border-line bg-white px-3 py-2 pr-9 text-sm font-medium text-ink transition-colors focus-visible:border-brand-strong focus-visible:outline-none"
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                    {w === CURRENT_WEEK ? " · current" : ""}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
            </div>
          </label>
        </div>

        {!isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Picks are open for <span className="font-semibold text-ink-soft">Week {CURRENT_WEEK}</span> only —
            you&apos;re previewing Week {viewWeek}. Used teams stay flagged so you can plan ahead.
          </p>
        ) : null}

        {byes.length > 0 ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            On bye this week:{" "}
            <span className="font-mono font-semibold text-ink-soft">
              {byes.map((b) => getTeam(b)?.abbr).filter(Boolean).join(", ")}
            </span>{" "}
            — not pickable.
          </p>
        ) : null}

        <WeekSchedule
          week={viewWeek}
          games={games}
          usedByTeam={usedByTeam}
          selectedTeam={isCurrent ? pickTeam : null}
          interactive={isCurrent}
          now={now}
          onSelect={setPickTeam}
        />
      </div>
    </div>
  );
}

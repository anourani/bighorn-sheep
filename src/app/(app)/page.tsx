"use client";

import { useMemo, useRef, useState } from "react";
import { StatusHero } from "@/components/picks/StatusHero";
import { CurrentPickCard } from "@/components/picks/CurrentPickCard";
import { WeekSchedule } from "@/components/picks/WeekSchedule";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { ChevronDownIcon, InfoIcon } from "@/components/icons";
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
  const scheduleRef = useRef<HTMLDivElement>(null);

  const isCurrent = viewWeek === CURRENT_WEEK;
  const games = WEEK_GAMES[viewWeek] ?? [];
  const byes = BYES_BY_WEEK[viewWeek] ?? [];

  // Teams already spent this season — burned for every week, so they stay
  // flagged even while browsing ahead ("plan which teams to save").
  const usedByTeam = useMemo(
    () => new Map<TeamId, HistoryPick>(me.history.map((h) => [h.teamId, h])),
    [me.history],
  );

  const pickGame = isCurrent && pickTeam ? gameForTeam(CURRENT_WEEK, pickTeam) : undefined;

  const weekOptions = useMemo(
    () => Array.from({ length: FINAL_WEEK - CURRENT_WEEK + 1 }, (_, i) => CURRENT_WEEK + i),
    [],
  );

  function scrollToSchedule() {
    scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="stagger space-y-4 md:grid md:grid-cols-[340px_minmax(0,1fr)] md:items-start md:gap-5 md:space-y-0">
      {/* Left rail — status + pick controls. Stacks above the schedule on phones. */}
      <div className="space-y-4">
        <StatusHero member={me} rules={rules} week={CURRENT_WEEK} />

        <div>
          <div className="mb-3">
            <MonoLabel className="text-ink-mute">Week {viewWeek}</MonoLabel>
            <h2 className="mt-0.5 text-sm font-semibold text-ink">
              {isCurrent ? "Your pick" : `Week ${viewWeek} preview`}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {isCurrent
                ? "Choose the team you think will win. Editable until each game kicks off — a team can only be used once all season."
                : "Browsing a future week. You can only set your current-week pick, but used teams stay flagged so you can plan ahead."}
            </p>
          </div>

          <label className="block">
            <MonoLabel className="mb-1.5 block text-ink-mute">Change week</MonoLabel>
            <div className="relative">
              <select
                value={viewWeek}
                onChange={(e) => setViewWeek(Number(e.target.value))}
                className="w-full appearance-none rounded-control border border-line bg-white px-3 py-2.5 pr-10 text-sm font-medium text-ink transition-colors focus-visible:border-brand-strong focus-visible:outline-none"
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

        {isCurrent ? (
          <CurrentPickCard
            teamId={pickTeam}
            game={pickGame}
            week={CURRENT_WEEK}
            rules={rules}
            now={now}
            weekFinalKickoff={weekFinalKickoff(CURRENT_WEEK)}
            onChange={scrollToSchedule}
          />
        ) : (
          <Panel tone="light" className="flex items-start gap-2.5 p-card">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-strong" />
            <p className="text-sm text-ink-soft">
              Picks are open for <span className="font-semibold text-ink">Week {CURRENT_WEEK}</span> only.
              You&apos;re viewing Week {viewWeek} to look ahead — switch back to make or change your pick.
            </p>
          </Panel>
        )}
      </div>

      {/* Right — the week's schedule (flows into multiple card columns as width allows). */}
      <div ref={scheduleRef} className="scroll-mt-20">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <MonoLabel className="text-ink-mute">Week {viewWeek}</MonoLabel>
            <h2 className="mt-0.5 text-sm font-semibold text-ink">Schedule</h2>
          </div>
          <MonoLabel className="text-ink-mute">
            {isCurrent ? "Select a team" : "Preview"}
          </MonoLabel>
        </div>

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

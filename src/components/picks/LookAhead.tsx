"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { LocalTime } from "@/components/ui/LocalTime";
import { ChevronDownIcon, CalendarIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";

export interface LookAheadWeek {
  week: number;
  games: Game[];
  byes: TeamId[];
}

export function LookAhead({
  weeks,
  usedTeams,
}: {
  weeks: LookAheadWeek[];
  usedTeams: Set<TeamId>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Panel tone="light" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-card py-4 text-left"
      >
        <span className="flex items-center gap-2.5">
          <CalendarIcon className="h-5 w-5 text-brand-strong" />
          <span>
            <span className="block text-sm font-semibold text-ink">Look ahead</span>
            <MonoLabel className="text-ink-mute">Plan which teams to save</MonoLabel>
          </span>
        </span>
        <ChevronDownIcon
          className={cn("h-5 w-5 shrink-0 text-ink-mute transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="border-t border-line px-card pb-4 pt-1">
          {weeks.map((w) => (
            <WeekBlock key={w.week} week={w} usedTeams={usedTeams} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function WeekBlock({ week, usedTeams }: { week: LookAheadWeek; usedTeams: Set<TeamId> }) {
  const released = week.games.length > 0;
  return (
    <div className="border-b border-line/70 py-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <MonoLabel className="text-ink-soft">Week {week.week}</MonoLabel>
        {released && week.byes.length > 0 ? (
          <span className="text-xs text-ink-mute">
            Bye: {week.byes.map((b) => getTeam(b)?.abbr).filter(Boolean).join(", ")}
          </span>
        ) : null}
      </div>

      {released ? (
        <ul className="space-y-1">
          {week.games.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="flex items-center gap-1.5">
                <TeamTag teamId={g.away} used={usedTeams.has(g.away)} />
                <span className="text-ink-mute">@</span>
                <TeamTag teamId={g.home} used={usedTeams.has(g.home)} />
              </span>
              <LocalTime iso={g.kickoff} className="shrink-0 font-mono text-xs text-ink-mute" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-control border border-dashed border-line bg-[#FAFAFB] px-3 py-3 text-center text-sm text-ink-mute">
          Schedule not yet released
        </div>
      )}
    </div>
  );
}

function TeamTag({ teamId, used }: { teamId: TeamId; used: boolean }) {
  const team = getTeam(teamId);
  if (!team) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1", used && "opacity-40")}
      title={used ? `${team.name} — already used` : team.name}
    >
      <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ backgroundColor: team.color }} />
      <span className={cn("font-mono text-xs font-semibold", used && "line-through")}>{team.abbr}</span>
    </span>
  );
}

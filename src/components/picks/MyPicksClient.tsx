"use client";

import { useMemo, useState, useTransition } from "react";
import { PickHero } from "@/components/picks/PickHero";
import { WeekSchedule } from "@/components/picks/WeekSchedule";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { LocalTime } from "@/components/ui/LocalTime";
import { ChevronDownIcon, InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { buildGameIndex } from "@/lib/league/games";
import type { LeagueData } from "@/lib/league/load";
import type { HistoryPick } from "@/lib/league/types";
import { submitPick } from "@/app/app/actions";

/** Friendly copy for a rejected pick (mirrors the canPick reason codes). */
const PICK_ERROR: Record<string, string> = {
  team_already_used: "You've already used that team this season.",
  game_kicked_off: "That game has kicked off — pick locked.",
  eliminated: "You're eliminated, so picks are closed.",
  no_game_for_team: "That team isn't playing this week.",
  entry_closed: "Entry for this league has closed.",
  not_a_member: "You're not a member of this league.",
};

export function MyPicksClient({ data }: { data: LeagueData }) {
  const { group, currentWeek, finalWeek, nowIso, phase } = data;
  const me = data.members.find((m) => m.id === data.viewer.id);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const isPreseason = phase === "preseason";

  const [viewWeek, setViewWeek] = useState(currentWeek);
  // In preseason a fresh entrant has no standing pick yet.
  const [pickTeam, setPickTeam] = useState<TeamId | null>(
    isPreseason ? null : (me?.currentPick?.teamId ?? null),
  );
  const [pickError, setPickError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const isCurrent = viewWeek === currentWeek;
  const games = useMemo(
    () =>
      data.games
        .filter((g) => g.week === viewWeek)
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    [data.games, viewWeek],
  );
  const byes = idx.byesForWeek(viewWeek);

  // Teams already spent this season — burned for every week, so they stay
  // flagged even while browsing ahead. A preseason entrant has spent none.
  const usedByTeam = useMemo(
    () =>
      isPreseason || !me
        ? new Map<TeamId, HistoryPick>()
        : new Map<TeamId, HistoryPick>(me.history.map((h) => [h.teamId, h])),
    [me, isPreseason],
  );

  const pickGame = pickTeam ? idx.gameForTeam(currentWeek, pickTeam) : undefined;

  const weekOptions = useMemo(
    () => Array.from({ length: finalWeek - currentWeek + 1 }, (_, i) => currentWeek + i),
    [finalWeek, currentWeek],
  );

  function handleSelect(teamId: TeamId) {
    const previous = pickTeam;
    setPickTeam(teamId); // optimistic
    setPickError(null);
    startTransition(async () => {
      const res = await submitPick({ groupId: group.id, teamId });
      if (!res.ok) {
        setPickTeam(previous); // revert on rejection
        setPickError(PICK_ERROR[res.error] ?? "Couldn't save that pick. Try again.");
      }
    });
  }

  return (
    <div className="stagger space-y-4">
      {isPreseason ? (
        <div className="rounded-card border border-brand/30 bg-brand-wash px-4 py-3">
          <MonoLabel className="text-[#8A4A24]">Pre-season</MonoLabel>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            The season kicks off{" "}
            <LocalTime iso={group.entryClosesAt} mode="full" className="font-semibold" />. Make your Week 1
            pick now — it locks when your team plays, and you can change it anytime until then.
          </p>
        </div>
      ) : null}

      <PickHero
        week={currentWeek}
        teamId={pickTeam}
        game={pickGame}
        now={now}
        weekFinalKickoff={idx.weekFinalKickoff(currentWeek)}
      />

      {pickError ? (
        <div className="flex items-start gap-2 rounded-control border border-out/30 bg-out-wash px-3 py-2.5 text-sm text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pickError}</span>
        </div>
      ) : null}

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
                    {w === currentWeek ? " · current" : ""}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
            </div>
          </label>
        </div>

        {!isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Picks are open for <span className="font-semibold text-ink-soft">Week {currentWeek}</span> only —
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
          interactive={isCurrent && !saving}
          now={now}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}

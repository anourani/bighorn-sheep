"use client";

import { cn } from "@/lib/cn";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { isHome } from "@/lib/league/view";
import type { HistoryPick } from "@/lib/league/types";

/**
 * The week's matchups as a radio group — one pick per week across every game.
 * Selecting a team's radio sets the pick immediately (editable until that game
 * kicks off). Teams already used this season, teams whose game has kicked off,
 * and every team while browsing a non-current week are shown but not selectable.
 */
export function WeekSchedule({
  week,
  games,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  onSelect,
}: {
  week: number;
  games: Game[];
  usedByTeam: Map<TeamId, HistoryPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  onSelect: (teamId: TeamId) => void;
}) {
  if (games.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-line bg-[#FAFAFB] px-3 py-8 text-center text-sm text-ink-mute">
        Schedule not yet released for Week {week}.
      </div>
    );
  }

  const groupName = `week-${week}-pick`;
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="sr-only">Pick your Week {week} team</legend>
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          groupName={groupName}
          usedByTeam={usedByTeam}
          selectedTeam={selectedTeam}
          interactive={interactive}
          now={now}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}

function GameCard({
  game,
  groupName,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  onSelect,
}: {
  game: Game;
  groupName: string;
  usedByTeam: Map<TeamId, HistoryPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  onSelect: (teamId: TeamId) => void;
}) {
  const kicked = isKickedOff(game, now);
  // Home team first, then away — mirrors the matchup layout on the pick screen.
  const order: TeamId[] = [game.home, game.away];

  return (
    <div className="overflow-hidden rounded-control border border-line bg-white">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <LocalTime iso={game.kickoff} className="font-mono text-[11px] text-ink-mute" />
        {kicked ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ink-mute">
            <LockIcon className="h-3 w-3" />
            {game.status === "final" ? "Final" : game.status === "in_progress" ? "Live" : "Locked"}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 divide-y divide-line/70">
        {order.map((teamId) => (
          <TeamOption
            key={teamId}
            teamId={teamId}
            game={game}
            groupName={groupName}
            used={usedByTeam.get(teamId)}
            selected={selectedTeam === teamId}
            interactive={interactive}
            kicked={kicked}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TeamOption({
  teamId,
  game,
  groupName,
  used,
  selected,
  interactive,
  kicked,
  onSelect,
}: {
  teamId: TeamId;
  game: Game;
  groupName: string;
  used: HistoryPick | undefined;
  selected: boolean;
  interactive: boolean;
  kicked: boolean;
  onSelect: (teamId: TeamId) => void;
}) {
  const team = getTeam(teamId)!;
  const home = isHome(game, teamId);
  const selectable = interactive && !used && !kicked;

  const detail = used
    ? `Used · W${used.week}`
    : kicked && interactive
      ? "Locked"
      : home
        ? "Home"
        : "Away";

  const label = used
    ? `${team.name}, already used in Week ${used.week}`
    : !selectable
      ? `${team.name}, not selectable`
      : `Pick the ${team.name}`;

  return (
    <label
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 transition-colors",
        selectable ? "cursor-pointer hover:bg-[#FAFAFB]" : "cursor-not-allowed",
        selected && "bg-brand-wash",
      )}
    >
      <input
        type="radio"
        name={groupName}
        className="peer sr-only"
        checked={selected}
        disabled={!selectable}
        onChange={() => selectable && onSelect(teamId)}
        aria-label={label}
      />

      <TeamLogo teamId={teamId} size="sm" className={cn(used && "opacity-40")} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              selected ? "text-[#B85C2B]" : used ? "text-ink-mute line-through" : "text-ink",
            )}
          >
            {team.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-mute">
            {team.abbr}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs",
            used ? "text-out/80" : "text-ink-soft",
          )}
        >
          {detail}
        </span>
      </span>

      {/* Custom radio, driven by React state; the real input above stays for a11y. */}
      <span
        aria-hidden
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-all",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/60 peer-focus-visible:ring-offset-1",
          selected ? "border-[6px] border-brand-strong" : "border-line",
          !selectable && !selected && "opacity-40",
        )}
      />
    </label>
  );
}

"use client";

import { cn } from "@/lib/cn";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { weekKey, type WeekRef } from "@/lib/nfl/calendar";
import { isHome } from "@/lib/league/view";

/**
 * A team already spent, and the week it went. Only the week is needed — a pick
 * whose game hasn't finished still spends its team, so requiring a resolved
 * `result` here would silently omit unresolved picks from the used list.
 */
export interface UsedPick {
  week: number;
}

/**
 * The week's matchups as a radio group — one pick per week across every game.
 * Selecting a team's radio sets the pick immediately (editable until that game
 * kicks off). Teams already used this season, teams whose game has kicked off,
 * and every team while browsing a non-current week are shown but not selectable.
 *
 * `weekRef` identifies the week including its phase, so preseason week 2 and
 * regular week 2 get distinct radio-group names and distinct copy. `weekName` is
 * the already-formatted label ("Week 2", "Preseason 2", "Hall of Fame") — passed
 * in rather than derived here, because only the caller knows how many preseason
 * weeks the loaded schedule has.
 */
export function WeekSchedule({
  weekRef,
  weekName,
  games,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  onSelect,
}: {
  weekRef: WeekRef;
  weekName: string;
  games: Game[];
  usedByTeam: Map<TeamId, UsedPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  onSelect: (teamId: TeamId) => void;
}) {
  if (games.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-line bg-[#FAFAFB] px-3 py-8 text-center text-sm text-ink-mute">
        Schedule not yet released for {weekName}.
      </div>
    );
  }

  const groupName = `${weekKey(weekRef)}-pick`;
  return (
    <fieldset className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
      <legend className="sr-only">Pick your {weekName} team</legend>
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
  usedByTeam: Map<TeamId, UsedPick>;
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
  used: UsedPick | undefined;
  selected: boolean;
  interactive: boolean;
  kicked: boolean;
  onSelect: (teamId: TeamId) => void;
}) {
  // Not `getTeam(teamId)!`. games.home/away are bare text with no foreign key, so
  // a feed change or a bad manual row can carry a code that isn't one of the 32 —
  // and the non-null assertion turned that single row into a blank picks page for
  // everyone. The importer validates codes on the way in; this is the backstop for
  // anything already stored. Render the row as unpickable rather than crashing.
  const team = getTeam(teamId);
  if (!team) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-mute">
        <span className="font-mono text-[10px] uppercase tracking-wide">{teamId || "unknown"}</span>
        <span className="text-xs">Unrecognized team — not pickable.</span>
      </div>
    );
  }

  const home = isHome(game, teamId);
  const selectable = interactive && !used && !kicked;

  const detail = used
    ? `Used · W${used.week}`
    : kicked && interactive
      ? "Locked"
      : home
        ? "Home"
        : "Away";

  // `selected` first: on a week you are only previewing, your own pick is not
  // selectable, and announcing it as "not selectable" buries the one fact that
  // matters — that this is the team you went with.
  const label = selected
    ? `${team.name}, your pick`
    : used
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

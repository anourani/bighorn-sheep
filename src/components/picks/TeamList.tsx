"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/icons";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LocalTime } from "@/components/ui/LocalTime";
import { TEAMS, getTeam } from "@/lib/nfl/teams";
import type { Game, TeamId } from "@/lib/nfl/types";
import type { TeamRecord } from "@/lib/league/types";
import {
  isHome,
  opponentOf,
  orderPickerTeams,
  type AvailabilityCounts,
  type TeamAvailability,
  type TeamSort,
} from "@/lib/league/view";

/** The three picker modes, mapped onto the pure `orderPickerTeams` options. */
type PickerMode = "available" | "record" | "kickoff";
const MODES: Record<PickerMode, { sort: TeamSort; availableOnly: boolean }> = {
  available: { sort: "default", availableOnly: true },
  record: { sort: "record", availableOnly: false },
  kickoff: { sort: "kickoff", availableOnly: false },
};

function recordLabel(r: TeamRecord): string {
  return r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

export function TeamList({
  states,
  counts,
  recordFor,
  gameFor,
  onSelect,
}: {
  states: Map<TeamId, TeamAvailability>;
  counts: AvailabilityCounts;
  recordFor: (id: TeamId) => TeamRecord;
  gameFor: (id: TeamId) => Game | undefined;
  onSelect: (teamId: TeamId) => void;
}) {
  const [mode, setMode] = useState<PickerMode>("available");

  const options: SegmentedOption<PickerMode>[] = [
    { value: "available", label: `Available · ${counts.available}` },
    { value: "record", label: "Best record" },
    { value: "kickoff", label: "Kickoff" },
  ];

  const ordered = orderPickerTeams(
    TEAMS.map((t) => t.id),
    states,
    MODES[mode],
    { recordFor, gameFor },
  );

  return (
    <section aria-label="Team picker">
      {/* Legend + live counts */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <LegendDot className="bg-white ring-1 ring-line" /> {counts.available} available
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <LegendDot className="bg-[#D7DAE0]" /> {counts.used} used
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="h-2.5 w-2.5 rounded-full border border-dashed border-ink-mute bg-white" /> {counts.bye} on bye
        </span>
      </div>

      {/* Filter / sort */}
      <Segmented options={options} value={mode} onChange={setMode} className="mb-3 flex w-full" />

      {ordered.length === 0 ? (
        <p className="rounded-control border border-dashed border-line bg-white px-3 py-6 text-center text-sm text-ink-soft">
          No teams match this filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((id) => (
            <TeamRow
              key={id}
              teamId={id}
              state={states.get(id) ?? { state: "available" }}
              record={recordFor(id)}
              game={gameFor(id)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LegendDot({ className }: { className: string }) {
  return <span className={cn("h-2 w-2 rounded-full", className)} />;
}

function TeamRow({
  teamId,
  state,
  record,
  game,
  onSelect,
}: {
  teamId: TeamId;
  state: TeamAvailability;
  record: TeamRecord;
  game: Game | undefined;
  onSelect: (teamId: TeamId) => void;
}) {
  const team = getTeam(teamId)!;
  const selectable = state.state === "available";
  const selected = state.state === "selected";
  const dimmed = state.state === "used" || state.state === "bye";

  const label =
    state.state === "used"
      ? `${team.name}, already used in week ${state.week} (${state.result})`
      : state.state === "bye"
        ? `${team.name}, on bye this week`
        : state.state === "selected"
          ? `${team.name}, your current pick`
          : `${team.name}, available — tap to pick`;

  const secondary =
    state.state === "used" ? (
      `Used in Week ${state.week}`
    ) : state.state === "bye" ? (
      "On bye this week"
    ) : game ? (
      <>
        {isHome(game, teamId) ? "vs" : "@"} {getTeam(opponentOf(game, teamId))?.abbr ?? "TBD"}
        {" · "}
        <LocalTime iso={game.kickoff} />
      </>
    ) : (
      "—"
    );

  return (
    <li>
      <button
        type="button"
        disabled={!selectable && !selected}
        aria-label={label}
        aria-pressed={selected}
        onClick={() => selectable && onSelect(teamId)}
        className={cn(
          "tap-target flex w-full items-center gap-3 rounded-control border p-2.5 text-left transition-all duration-150",
          selectable && "border-line bg-white hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-panel-sm",
          selected && "border-2 border-brand-strong bg-brand-wash",
          state.state === "used" && "cursor-not-allowed border-line bg-[#F4F5F7]",
          state.state === "bye" && "cursor-not-allowed border-dashed border-line bg-white",
        )}
      >
        <TeamLogo teamId={teamId} size="sm" className={cn(state.state === "used" && "opacity-40")} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                selected ? "text-[#B85C2B]" : dimmed ? "text-ink-mute" : "text-ink",
              )}
            >
              {team.location} {team.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-mute">
              {team.abbr}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-soft">{secondary}</span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("font-mono text-sm tabular-nums", dimmed ? "text-ink-mute" : "text-ink")}>
            {recordLabel(record)}
          </span>
          {selected ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-brand-strong px-1.5 py-0.5 text-white">
              <CheckIcon className="h-3 w-3" />
              <MonoLabel className="text-[10px] text-white">Pick</MonoLabel>
            </span>
          ) : state.state === "used" ? (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                state.result === "win" ? "bg-alive" : state.result === "push" ? "bg-[#4C7CB0]" : "bg-out",
              )}
              aria-hidden
            />
          ) : state.state === "bye" ? (
            <MonoLabel className="text-[10px] text-ink-mute">Bye</MonoLabel>
          ) : null}
        </span>
      </button>
    </li>
  );
}

"use client";

import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/icons";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { TEAMS, getTeam } from "@/lib/nfl/teams";
import type { TeamId } from "@/lib/nfl/types";
import type { AvailabilityCounts, TeamAvailability } from "@/lib/league/view";

function LegendDot({ className }: { className: string }) {
  return <span className={cn("h-2 w-2 rounded-full", className)} />;
}

export function TeamGrid({
  states,
  counts,
  onSelect,
}: {
  states: Map<TeamId, TeamAvailability>;
  counts: AvailabilityCounts;
  onSelect: (teamId: TeamId) => void;
}) {
  return (
    <section aria-label="Team grid">
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

      <div className="grid grid-cols-4 gap-2">
        {TEAMS.map((team) => {
          const state = states.get(team.id) ?? { state: "available" as const };
          return <TeamCell key={team.id} teamId={team.id} state={state} onSelect={onSelect} />;
        })}
      </div>
    </section>
  );
}

function TeamCell({
  teamId,
  state,
  onSelect,
}: {
  teamId: TeamId;
  state: TeamAvailability;
  onSelect: (teamId: TeamId) => void;
}) {
  const team = getTeam(teamId)!;
  const selectable = state.state === "available";
  const selected = state.state === "selected";

  const label =
    state.state === "used"
      ? `${team.name}, already used in week ${state.week} (${state.result})`
      : state.state === "bye"
        ? `${team.name}, on bye this week`
        : state.state === "selected"
          ? `${team.name}, your current pick`
          : `${team.name}, available — tap to pick`;

  return (
    <button
      type="button"
      disabled={!selectable && !selected}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => selectable && onSelect(teamId)}
      className={cn(
        "tap-target relative flex h-[68px] flex-col justify-between rounded-control p-2 text-left transition-all duration-150",
        selectable &&
          "border border-line bg-white hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-panel-sm",
        selected && "border-2 border-brand-strong bg-brand-wash",
        state.state === "used" && "cursor-not-allowed border border-line bg-[#F4F5F7]",
        state.state === "bye" && "cursor-not-allowed border border-dashed border-line bg-white",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn("h-2.5 w-2.5 rounded-full ring-1 ring-black/10", state.state === "used" && "opacity-40")}
          style={{ backgroundColor: team.color }}
          aria-hidden
        />
        <span
          className={cn(
            "font-mono text-sm font-bold tracking-wide",
            selected ? "text-[#B85C2B]" : state.state === "used" || state.state === "bye" ? "text-ink-mute" : "text-ink",
          )}
        >
          {team.abbr}
        </span>
      </span>

      {selected ? (
        <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-brand-strong text-white">
          <CheckIcon className="h-3 w-3" />
        </span>
      ) : null}

      <span className="flex items-center justify-between">
        {state.state === "selected" ? (
          <MonoLabel className="text-[10px] text-[#B85C2B]">Pick</MonoLabel>
        ) : state.state === "used" ? (
          <span className="flex items-center gap-1">
            <MonoLabel className="text-[10px] text-ink-mute">W{state.week}</MonoLabel>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                state.result === "win" ? "bg-alive" : state.result === "push" ? "bg-[#4C7CB0]" : "bg-out",
              )}
              aria-hidden
            />
          </span>
        ) : state.state === "bye" ? (
          <MonoLabel className="text-[10px] text-ink-mute">Bye</MonoLabel>
        ) : (
          <span aria-hidden />
        )}
      </span>
    </button>
  );
}

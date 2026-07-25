import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { ClockIcon, LockIcon, InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { opponentOf, isHome, teamScoreline } from "@/lib/league/view";
import { evaluateTeamPick } from "@/lib/game/elimination";
import type { GroupRules } from "@/lib/league/types";

export function CurrentPickCard({
  teamId,
  game,
  week,
  rules,
  now,
  weekFinalKickoff,
  onChange,
}: {
  teamId: TeamId | null;
  game: Game | undefined;
  week: number;
  rules: GroupRules;
  now: Date;
  weekFinalKickoff: Date | null;
  onChange: () => void;
}) {
  // No pick yet — surface the final deadline and nudge to the grid.
  if (!teamId || !game) {
    const cd = weekFinalKickoff ? countdown(weekFinalKickoff, now) : null;
    return (
      <Panel className="p-card">
        <div className="flex items-center justify-between">
          <MonoLabel className="text-onsurface-mute">Your Pick · Week {week}</MonoLabel>
          <Pill variant="pending">No pick</Pill>
        </div>
        <p className="mt-3 text-sm text-onsurface-soft">
          You haven&apos;t picked yet. Miss the final kickoff and it counts as a loss.
        </p>
        {cd ? (
          <div className="mt-4 flex items-center gap-2 rounded-control bg-black/20 px-3 py-2.5">
            <ClockIcon className="h-4 w-4 text-brand-soft" />
            <span className="text-sm text-onsurface">
              Week locks in{" "}
              <span className="font-mono font-semibold text-brand-soft">{cd.label}</span>
            </span>
          </div>
        ) : null}
        <Button variant="primary" block className="mt-4" onClick={onChange}>
          Choose your team
        </Button>
      </Panel>
    );
  }

  const team = getTeam(teamId)!;
  const opp = getTeam(opponentOf(game, teamId));
  const home = isHome(game, teamId);
  const kicked = isKickedOff(game, now);
  const cd = countdown(new Date(game.kickoff), now);
  const score = teamScoreline(game, teamId);
  const result = game.status === "final" ? evaluateTeamPick(game, teamId, rules) : null;

  const statusPill =
    game.status === "final" ? (
      <Pill variant={result === "win" ? "win" : result === "push" ? "push" : "loss"}>
        {result === "win" ? "Survived" : result === "push" ? "Push" : "Lost"}
      </Pill>
    ) : game.status === "in_progress" ? (
      <Pill variant="live" live>
        Live
      </Pill>
    ) : kicked ? (
      <Pill variant="hidden" icon={<LockIcon />}>
        Locked
      </Pill>
    ) : (
      <Pill variant="brand">Open</Pill>
    );

  return (
    <Panel className="overflow-hidden">
      {/* Team accent bar */}
      <div className="h-1 w-full" style={{ backgroundColor: team.color }} aria-hidden />
      <div className="p-card">
        <div className="flex items-center justify-between">
          <MonoLabel className="text-onsurface-mute">Your Pick · Week {week}</MonoLabel>
          {statusPill}
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className="h-9 w-9 shrink-0 rounded-[10px] ring-1 ring-white/15"
                style={{ backgroundColor: team.color }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-mono text-xl font-bold leading-none tracking-wide text-onsurface">
                  {team.abbr}
                </div>
                <div className="mt-1 truncate text-sm text-onsurface-soft">
                  {team.location} {team.name}
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm text-onsurface-soft">
              {home ? "vs" : "@"} {opp?.name ?? "TBD"} ·{" "}
              <LocalTime iso={game.kickoff} className="text-onsurface" />
            </div>
          </div>

          {score ? (
            <div className="text-right">
              <div className="font-mono text-3xl font-semibold tabular-nums text-onsurface">
                {score.for}
                <span className="mx-1 text-onsurface-mute">–</span>
                {score.against}
              </div>
              {game.statusDetail ? (
                <MonoLabel className="text-onsurface-mute">{game.statusDetail}</MonoLabel>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Lock / countdown */}
        <div className="mt-4 flex items-center gap-2 rounded-control bg-black/20 px-3 py-2.5">
          {kicked ? (
            <>
              <LockIcon className="h-4 w-4 text-onsurface-mute" />
              <span className="text-sm text-onsurface-soft">Locked at kickoff — can&apos;t be changed.</span>
            </>
          ) : (
            <>
              <ClockIcon className="h-4 w-4 text-brand-soft" />
              <span className="text-sm text-onsurface">
                Locks in <span className="font-mono font-semibold text-brand-soft">{cd.label}</span>
                <span className="text-onsurface-mute"> · editable until then</span>
              </span>
            </>
          )}
        </div>

        {/* Privacy note — own pick always visible to you; others see it at kickoff */}
        <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-onsurface-mute">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {kicked
              ? "This game has kicked off — your pick is now visible to the group."
              : "Only you can see this pick. The group sees it the moment this game kicks off."}
          </span>
        </div>

        {!kicked ? (
          <Button variant="subtle" block className="mt-4" onClick={onChange}>
            Change pick
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

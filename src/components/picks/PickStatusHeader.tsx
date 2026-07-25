import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { ClockIcon, LockIcon, InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { opponentOf, isHome, teamScoreline } from "@/lib/league/view";
import { evaluateTeamPick } from "@/lib/game/elimination";
import { strikeAllowance, type GroupRules, type Member } from "@/lib/league/types";

/**
 * The My Picks banner: one horizontal slate header (like the Standings header)
 * that pairs the player's survival status with their current-week pick and its
 * details. The two zones sit side by side on desktop and stack on phones.
 */
export function PickStatusHeader({
  member,
  rules,
  week,
  teamId,
  game,
  now,
  weekFinalKickoff,
}: {
  member: Member;
  rules: GroupRules;
  week: number;
  teamId: TeamId | null;
  game: Game | undefined;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  return (
    <Panel className="overflow-hidden p-0">
      <div className="flex flex-col md:flex-row">
        <StatusZone member={member} rules={rules} />
        <PickZone
          week={week}
          teamId={teamId}
          game={game}
          rules={rules}
          now={now}
          weekFinalKickoff={weekFinalKickoff}
        />
      </div>
    </Panel>
  );
}

function StatusZone({ member, rules }: { member: Member; rules: GroupRules }) {
  const allowance = strikeAllowance(rules.eliminationType);
  const alive = member.status === "alive";
  const eliminatedTeam = member.eliminatedWeek
    ? member.history.find((h) => h.week === member.eliminatedWeek && h.result === "loss")
    : undefined;

  return (
    <div className="p-card md:flex-[2]">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel className="text-onsurface-mute">Your Status</MonoLabel>
        {alive ? <Pill variant="alive">Alive</Pill> : <Pill variant="out">Eliminated</Pill>}
      </div>
      <h1 className="mt-3 text-display-sm font-medium tracking-tight text-onsurface">
        {alive ? "Still standing." : "You're out."}
      </h1>
      <p className="mt-1.5 max-w-[38ch] text-sm leading-relaxed text-onsurface-soft">
        {alive
          ? allowance === 1
            ? "One loss ends your run — a team can only be used once all season."
            : "Two losses and you're out — choose carefully."
          : member.eliminatedWeek
            ? `Knocked out in Week ${member.eliminatedWeek}${
                eliminatedTeam ? ` — ${getTeam(eliminatedTeam.teamId)?.name ?? ""} lost.` : "."
              } You can still follow the league.`
            : "You can still follow the league from here."}
      </p>
    </div>
  );
}

function PickZone({
  week,
  teamId,
  game,
  rules,
  now,
  weekFinalKickoff,
}: {
  week: number;
  teamId: TeamId | null;
  game: Game | undefined;
  rules: GroupRules;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  const zone = "border-t border-white/10 p-card md:flex-[3] md:border-l md:border-t-0";

  // No pick yet — surface the final deadline and point at the schedule.
  if (!teamId || !game) {
    const cd = weekFinalKickoff ? countdown(weekFinalKickoff, now) : null;
    return (
      <div className={zone}>
        <div className="flex items-center justify-between gap-2">
          <MonoLabel className="text-onsurface-mute">Your Pick · Week {week}</MonoLabel>
          <Pill variant="pending">No pick</Pill>
        </div>
        <p className="mt-3 text-sm text-onsurface-soft">
          You haven&apos;t picked yet. Miss the final kickoff and it counts as a loss.
        </p>
        {cd ? (
          <div className="mt-3 flex items-center gap-2 rounded-control bg-black/20 px-3 py-2.5">
            <ClockIcon className="h-4 w-4 text-brand-soft" />
            <span className="text-sm text-onsurface">
              Week locks in <span className="font-mono font-semibold text-brand-soft">{cd.label}</span>
            </span>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-onsurface-mute">Choose a team from the schedule below.</p>
      </div>
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
    <div className={zone}>
      <div className="flex items-center justify-between gap-2">
        <MonoLabel className="text-onsurface-mute">Your Pick · Week {week}</MonoLabel>
        {statusPill}
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="grid shrink-0 place-items-center rounded-[14px] bg-white p-2 shadow-sm ring-1 ring-black/5"
            style={{ boxShadow: `0 0 0 2px ${team.color}` }}
          >
            <TeamLogo teamId={teamId} size="xl" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-2xl font-semibold leading-tight tracking-tight text-onsurface">
              {team.location} {team.name}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-onsurface-soft">
              <span className="font-mono font-bold tracking-wide">{team.abbr}</span>
              <span aria-hidden className="text-onsurface-mute">·</span>
              <span className="truncate">
                {home ? "vs" : "@"} {opp?.name ?? "TBD"}
              </span>
            </div>
            <div className="mt-0.5 text-sm">
              <LocalTime iso={game.kickoff} className="text-onsurface-mute" />
            </div>
          </div>
        </div>

        {score ? (
          <div className="shrink-0 text-right">
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

      <div className="mt-4 rounded-control bg-black/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {kicked ? (
            <>
              <LockIcon className="h-4 w-4 shrink-0 text-onsurface-mute" />
              <span className="text-sm text-onsurface-soft">Locked at kickoff — this pick can&apos;t be changed.</span>
            </>
          ) : (
            <>
              <ClockIcon className="h-4 w-4 shrink-0 text-brand-soft" />
              <span className="text-sm text-onsurface">
                Locks in <span className="font-mono font-semibold text-brand-soft">{cd.label}</span>
                <span className="text-onsurface-mute"> · editable until then</span>
              </span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-start gap-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-onsurface-mute">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {kicked
              ? "This game has kicked off — your pick is now visible to the group."
              : "Only you can see this pick until this game kicks off."}
          </span>
        </div>
      </div>
    </div>
  );
}

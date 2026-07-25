import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill, StrikePips } from "@/components/ui/Badge";
import { getTeam } from "@/lib/nfl/teams";
import { strikeAllowance, type GroupRules, type Member } from "@/lib/league/types";

/**
 * The first thing a player sees: their standing, unambiguously. An eliminated
 * player learns it (and why) the moment they open the app.
 */
export function StatusHero({
  member,
  rules,
  aliveCount,
  totalCount,
  week,
}: {
  member: Member;
  rules: GroupRules;
  aliveCount: number;
  totalCount: number;
  week: number;
}) {
  const allowance = strikeAllowance(rules.eliminationType);
  const alive = member.status === "alive";
  const eliminatedTeam = member.eliminatedWeek
    ? member.history.find((h) => h.week === member.eliminatedWeek && h.result === "loss")
    : undefined;

  return (
    <Panel className="overflow-hidden p-card">
      <div className="flex items-center justify-between">
        <MonoLabel className="text-onsurface-mute">Your Status</MonoLabel>
        {alive ? (
          <Pill variant="alive">Alive</Pill>
        ) : (
          <Pill variant="out">Eliminated</Pill>
        )}
      </div>

      <div className="mt-3">
        <h1 className="text-display-sm font-medium tracking-tight text-onsurface">
          {alive ? "Still standing." : "You're out."}
        </h1>
        <p className="mt-1.5 max-w-[36ch] text-sm leading-relaxed text-onsurface-soft">
          {alive
            ? allowance === 1
              ? "One loss ends your run. Pick carefully — a team can only be used once all season."
              : `Two losses and you're done. You've used ${member.strikes} of ${allowance} strikes.`
            : member.eliminatedWeek
              ? `Knocked out in Week ${member.eliminatedWeek}${
                  eliminatedTeam ? ` — ${getTeam(eliminatedTeam.teamId)?.name ?? ""} lost.` : "."
                } You can still follow the league.`
              : "You can still follow the league from here."}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
        <div>
          <MonoLabel className="text-onsurface-mute">Week</MonoLabel>
          <div className="mt-1 font-mono text-2xl tabular-nums text-onsurface">{week}</div>
        </div>
        <div>
          <MonoLabel className="text-onsurface-mute">Strikes</MonoLabel>
          <div className="mt-2 flex h-7 items-center">
            <StrikePips strikes={member.strikes} allowance={allowance} />
            <span className="ml-2 font-mono text-sm text-onsurface-soft">
              {member.strikes}/{allowance}
            </span>
          </div>
        </div>
        <div>
          <MonoLabel className="text-onsurface-mute">Field</MonoLabel>
          <div className="mt-1 font-mono text-2xl tabular-nums text-onsurface">
            {aliveCount}
            <span className="text-base text-onsurface-mute">/{totalCount}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { Metric } from "@/components/ui/Metric";
import { getTeam } from "@/lib/nfl/teams";
import { strikeAllowance, type GroupRules, type Member } from "@/lib/league/types";

/**
 * The first thing a player sees: their standing, unambiguously. An eliminated
 * player learns it (and why) the moment they open the app. Kept intentionally
 * lean — just status, the one-line stakes, and the current week.
 */
export function StatusHero({
  member,
  rules,
  week,
}: {
  member: Member;
  rules: GroupRules;
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
        {alive ? <Pill variant="alive">Alive</Pill> : <Pill variant="out">Eliminated</Pill>}
      </div>

      <div className="mt-3">
        <h1 className="text-display-sm font-medium tracking-tight text-onsurface">
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

      <div className="mt-5 border-t border-white/10 pt-4">
        <Metric label="Week" value={week} />
      </div>
    </Panel>
  );
}

"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill, StrikePips } from "@/components/ui/Badge";
import { TeamMark } from "@/components/ui/TeamMark";
import { ChevronDownIcon, LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";
import type { GroupRules, Member } from "@/lib/league/types";
import { strikeAllowance } from "@/lib/league/types";
import { teamScoreline, viewCurrentPick, type PickView } from "@/lib/league/view";

export interface RankedMember {
  member: Member;
  rank: number;
}

export function StandingsList({
  ranked,
  viewerId,
  week,
  rules,
  now,
  gameForTeam,
}: {
  ranked: RankedMember[];
  viewerId: string;
  week: number;
  rules: GroupRules;
  now: Date;
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined;
}) {
  const allowance = strikeAllowance(rules.eliminationType);
  return (
    <Panel className="overflow-hidden p-0">
      <ul className="divide-y divide-white/10">
        {ranked.map(({ member, rank }) => (
          <StandingRow
            key={member.id}
            member={member}
            rank={rank}
            isYou={member.id === viewerId}
            allowance={allowance}
            pick={viewCurrentPick(member, viewerId, week, gameForTeam, rules, now)}
          />
        ))}
      </ul>
    </Panel>
  );
}

function StandingRow({
  member,
  rank,
  isYou,
  allowance,
  pick,
}: {
  member: Member;
  rank: number;
  isYou: boolean;
  allowance: number;
  pick: PickView;
}) {
  const [open, setOpen] = useState(false);
  const eliminated = member.status === "eliminated";

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold tabular-nums",
            eliminated ? "bg-white/5 text-onsurface-mute" : "bg-white/10 text-onsurface",
          )}
        >
          {rank}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-sm font-semibold", eliminated ? "text-onsurface-mute" : "text-onsurface")}>
              {member.name}
            </span>
            {isYou ? (
              <MonoLabel className="shrink-0 rounded bg-brand/25 px-1 text-[10px] text-brand-soft">You</MonoLabel>
            ) : member.role === "admin" ? (
              <MonoLabel className="shrink-0 rounded bg-white/10 px-1 text-[10px] text-onsurface-mute">Admin</MonoLabel>
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-2">
            {eliminated ? (
              <Pill variant="out">Out · W{member.eliminatedWeek}</Pill>
            ) : (
              <>
                <StrikePips strikes={member.strikes} allowance={allowance} />
                <span className="font-mono text-[11px] text-onsurface-mute">
                  {member.strikes}/{allowance}
                </span>
              </>
            )}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <PickCell pick={pick} isYou={isYou} />
          <ChevronDownIcon
            className={cn("h-4 w-4 text-onsurface-mute transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open ? <HistoryStrip member={member} /> : null}
    </li>
  );
}

/** The current-week pick, subject to the per-game privacy reveal. */
function PickCell({ pick, isYou }: { pick: PickView; isYou: boolean }) {
  if (!pick.hasPick) {
    return <Pill variant="pending">No pick</Pill>;
  }
  if (!pick.revealed) {
    return (
      <Pill variant="hidden" icon={<LockIcon />}>
        Hidden
      </Pill>
    );
  }
  const teamId = pick.teamId!;
  const score = pick.game ? teamScoreline(pick.game, teamId) : null;

  return (
    <span className="flex items-center gap-2">
      <TeamMark teamId={teamId} className="text-onsurface" />
      {pick.status === "live" ? (
        <Pill variant="live" live>
          {score ? `${score.for}–${score.against}` : "Live"}
        </Pill>
      ) : pick.status === "final" ? (
        <Pill variant={pick.result === "win" ? "win" : pick.result === "push" ? "push" : "loss"}>
          {pick.result === "win" ? "Won" : pick.result === "push" ? "Push" : "Lost"}
        </Pill>
      ) : (
        <Pill variant="brand">{isYou ? "Pick" : "Open"}</Pill>
      )}
    </span>
  );
}

function HistoryStrip({ member }: { member: Member }) {
  const history = [...member.history].sort((a, b) => a.week - b.week);
  return (
    <div className="border-t border-white/10 bg-black/15 px-4 py-3">
      <MonoLabel className="text-onsurface-mute">Pick history</MonoLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {history.map((h) => {
          const team = getTeam(h.teamId);
          return (
            <span
              key={h.week}
              className="inline-flex items-center gap-1.5 rounded-control bg-white/[0.06] px-2 py-1"
            >
              <MonoLabel className="text-onsurface-mute">W{h.week}</MonoLabel>
              <span className="font-mono text-xs font-semibold text-onsurface">{team?.abbr}</span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  h.result === "win" ? "bg-alive" : h.result === "push" ? "bg-[#4C7CB0]" : "bg-out",
                )}
                aria-label={h.result}
              />
            </span>
          );
        })}
        {history.length === 0 ? <span className="text-xs text-onsurface-mute">No picks yet.</span> : null}
      </div>
    </div>
  );
}

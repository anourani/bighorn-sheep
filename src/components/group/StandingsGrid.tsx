"use client";

import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { StrikePips } from "@/components/ui/Badge";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";
import type { GroupRules, Member } from "@/lib/league/types";
import { strikeAllowance } from "@/lib/league/types";
import { viewCurrentPick } from "@/lib/league/view";

export interface RankedMember {
  member: Member;
  rank: number;
}

/** One column of the grid: which week, and what to print in the header. */
export interface WeekColumn {
  week: number;
  label: string;
}

/**
 * The season at a glance: one row per player, one column per week, each cell the
 * team they picked. Past weeks always show; the current week honors the per-game
 * privacy lock (a rival's pick is a padlock until that team's game kicks off).
 * Losses/pushes are washed so strikes read straight down a row; future weeks are
 * hollow slots. Replaces the old expand-per-row accordion.
 */
export function StandingsGrid({
  ranked,
  viewerId,
  currentWeek,
  finalWeek,
  columns,
  outLabel,
  rules,
  now,
  gameForTeam,
  hiddenPickUserIds = [],
}: {
  ranked: RankedMember[];
  viewerId: string;
  currentWeek: number;
  finalWeek: number;
  /**
   * The week columns to render. Defaults to the regular season's 1..finalWeek.
   * The preseason practice grid passes its own (shorter, differently labelled)
   * set — which is also how preseason leaves the standings at Week 1: the caller
   * simply stops rendering that grid.
   */
  columns?: WeekColumn[];
  /** How to name a week in the "Out · …" badge. Defaults to `W{n}`. */
  outLabel?: (week: number) => string;
  rules: GroupRules;
  now: Date;
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined;
  /**
   * user_ids with a locked-but-hidden pick this week. Under RLS a rival's hidden
   * pick returns no row at all, so this (team-less) flag is what lets the grid
   * still show a padlock rather than a bare "no pick" slot.
   */
  hiddenPickUserIds?: string[];
}) {
  const allowance = strikeAllowance(rules.eliminationType);
  const weeks: WeekColumn[] =
    columns ?? Array.from({ length: finalWeek }, (_, i) => ({ week: i + 1, label: String(i + 1) }));
  const formatOut = outLabel ?? ((w: number) => `W${w}`);
  const hiddenSet = new Set(hiddenPickUserIds);

  return (
    <div className="space-y-2">
      <Panel tone="light" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <HeadCell className="left-0 w-9 text-center">#</HeadCell>
                <HeadCell className="left-9 min-w-[8.75rem] border-r border-line text-left">
                  Name
                </HeadCell>
                {weeks.map((col) => (
                  <th
                    key={col.week}
                    scope="col"
                    className={cn(
                      "px-1 py-2.5 text-center text-[11px] font-semibold tabular-nums",
                      col.week === currentWeek ? "text-brand-strong" : "text-ink-mute",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ member, rank }) => {
                const isYou = member.id === viewerId;
                const eliminated = member.status === "eliminated";
                const stickyBg = isYou ? "bg-brand-wash" : "bg-white";
                return (
                  <tr
                    key={member.id}
                    className={cn(
                      "border-b border-line/70 last:border-b-0",
                      isYou && "bg-brand-wash/50",
                    )}
                  >
                    {/* Rank — sticky */}
                    <td
                      className={cn(
                        "sticky left-0 z-10 w-9 px-1 py-2 text-center align-middle",
                        stickyBg,
                        isYou && "border-l-2 border-brand-strong",
                      )}
                    >
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums",
                          eliminated ? "text-ink-mute" : "text-ink-soft",
                        )}
                      >
                        {rank}
                      </span>
                    </td>

                    {/* Name + status — sticky */}
                    <td
                      className={cn(
                        "sticky left-9 z-10 min-w-[8.75rem] border-r border-line px-2.5 py-2 align-middle",
                        stickyBg,
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-sm font-semibold",
                            eliminated ? "text-ink-mute" : "text-ink",
                          )}
                        >
                          {member.name}
                        </span>
                        {!isYou && member.role === "admin" ? (
                          <Label className="shrink-0 rounded bg-ink/10 px-1 text-ink-mute">
                            Admin
                          </Label>
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        {eliminated ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-out">
                            Out · {member.eliminatedWeek ? formatOut(member.eliminatedWeek) : "—"}
                          </span>
                        ) : (
                          <>
                            <StrikePips strikes={member.strikes} allowance={allowance} tone="light" />
                            <span className="text-[10px] font-semibold tabular-nums text-ink-mute">
                              {member.strikes}/{allowance}
                            </span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Weekly picks */}
                    {weeks.map((col) => (
                      <td key={col.week} className="px-1 py-1.5 text-center align-middle">
                        <WeekCell
                          cell={cellFor(member, viewerId, col.week, currentWeek, gameForTeam, rules, now, hiddenSet)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Legend />
    </div>
  );
}

function HeadCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky z-20 bg-white px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-mute",
        className,
      )}
    >
      {children}
    </th>
  );
}

// ── Cell model ───────────────────────────────────────────────────────────────

type WeekCell =
  | { kind: "empty" }
  | { kind: "hidden" }
  | { kind: "team"; teamId: TeamId; result?: "win" | "loss" | "push"; live?: boolean };

/** Derive one member's cell for one week, honoring the current-week privacy lock. */
function cellFor(
  member: Member,
  viewerId: string,
  week: number,
  currentWeek: number,
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined,
  rules: GroupRules,
  now: Date,
  hiddenSet: Set<string>,
): WeekCell {
  if (week < currentWeek) {
    const h = member.history.find((x) => x.week === week);
    return h ? { kind: "team", teamId: h.teamId, result: h.result } : { kind: "empty" };
  }
  if (week === currentWeek) {
    const pv = viewCurrentPick(member, viewerId, week, gameForTeam, rules, now);
    // RLS hides a rival's un-kicked pick entirely (no row → no currentPick), so
    // fall back to the team-less flag to still show the padlock.
    if (!pv.hasPick) return hiddenSet.has(member.id) ? { kind: "hidden" } : { kind: "empty" };
    if (!pv.revealed) return { kind: "hidden" };
    const result =
      pv.result === "win" || pv.result === "loss" || pv.result === "push" ? pv.result : undefined;
    return { kind: "team", teamId: pv.teamId!, result, live: pv.status === "live" };
  }
  return { kind: "empty" };
}

function WeekCell({ cell }: { cell: WeekCell }) {
  if (cell.kind === "empty") {
    return (
      <span className="mx-auto grid h-10 w-10 place-items-center" aria-hidden>
        <span className="h-3 w-3 rounded-full border border-line/80" />
        <span className="sr-only">No pick</span>
      </span>
    );
  }

  if (cell.kind === "hidden") {
    return (
      <span
        className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-[#EEF1F6] text-ink-mute"
        title="Hidden until kickoff"
      >
        <LockIcon className="h-4 w-4" />
        <span className="sr-only">Pick hidden until kickoff</span>
      </span>
    );
  }

  const team = getTeam(cell.teamId);
  const wash =
    cell.result === "loss"
      ? "bg-out-wash ring-1 ring-out/25"
      : cell.result === "push"
        ? "bg-[#E7EEF6] ring-1 ring-[#4C7CB0]/25"
        : cell.live
          ? "bg-live-wash ring-1 ring-live/30"
          : "";
  const resultLabel = cell.result ?? (cell.live ? "live" : "");

  return (
    <span
      className={cn("relative mx-auto grid h-10 w-10 place-items-center rounded-lg", wash)}
      title={team ? `${team.location} ${team.name}${resultLabel ? ` · ${resultLabel}` : ""}` : cell.teamId}
    >
      <TeamLogo teamId={cell.teamId} size={32} />
      {cell.live ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-pulse-live rounded-full bg-live" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
        </span>
      ) : null}
      <span className="sr-only">
        {team?.name ?? cell.teamId}
        {resultLabel ? `, ${resultLabel}` : ""}
      </span>
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-mute">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded bg-out-wash ring-1 ring-out/25" /> Loss
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded bg-[#E7EEF6] ring-1 ring-[#4C7CB0]/25" /> Push
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LockIcon className="h-3.5 w-3.5" /> Hidden until kickoff
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full border border-line/80" /> Upcoming
      </span>
    </div>
  );
}

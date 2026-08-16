"use client";

import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";
import type { GroupRules, Member } from "@/lib/league/types";
import { viewCurrentPick } from "@/lib/league/view";

export interface RankedMember {
  member: Member;
  rank: number;
}

/** One column of the grid: which week, and what to print in the header. */
export interface WeekColumn {
  week: number;
  label: string;
  /**
   * A column this grid holds no picks for — the regular season previewed at the
   * end of the practice table, so the season's full shape is on screen rather
   * than four columns and a stretch of empty panel.
   *
   * It renders as an upcoming slot WITHOUT consulting `history`, and that is
   * load-bearing: history is keyed by week number alone, so a regular-season
   * column for week 1 would otherwise collide with preseason week 1 and print
   * the practice pick under the regular-season header. Same collision `WeekRef`
   * exists to prevent everywhere else.
   */
  preview?: boolean;
}

/**
 * React key for a column. Not `col.week` — preview columns repeat the preseason
 * week numbers, and duplicate keys had two headers fighting over one slot.
 */
function colKey(col: WeekColumn): string {
  return `${col.preview ? "preview" : "week"}-${col.week}`;
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
  const weeks: WeekColumn[] =
    columns ?? Array.from({ length: finalWeek }, (_, i) => ({ week: i + 1, label: String(i + 1) }));
  const hiddenSet = new Set(hiddenPickUserIds);

  return (
    <div className="space-y-2">
      <Panel tone="light" className="overflow-hidden p-0">
        <div className="overflow-x-auto scroll-none">
          {/* min-w-full so the table is never narrower than the panel; w-max so
              it still grows past it and scrolls once the columns need the room. */}
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                {/* Rank and name share one cell — see the note on the body cell. */}
                <HeadCell className="left-0 min-w-[11rem] border-r border-line text-left">
                  <span className="flex items-center gap-2">
                    <span className="w-5 text-center">#</span>
                    <span>Name</span>
                  </span>
                </HeadCell>
                {weeks.map((col) => (
                  <th
                    key={colKey(col)}
                    scope="col"
                    className={cn(
                      "px-1 py-2.5 text-center text-[11px] font-semibold tabular-nums",
                      // Guarded on !preview: the practice grid's currentWeek is a
                      // preseason week number, which a previewed regular-season
                      // column of the same number would otherwise light up too.
                      !col.preview && col.week === currentWeek
                        ? "text-brand-strong"
                        : "text-ink-mute",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
                <Spacer head />
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ member, rank }) => {
                const isYou = member.id === viewerId;
                const eliminated = member.status === "eliminated";
                // Same token the row uses, so the sticky cell and the cells
                // scrolling past it are one flat colour. It has to be opaque
                // either way — a translucent sticky fill lets scrolled week
                // cells show through.
                const stickyBg = isYou ? "bg-brand-wash" : "bg-white";
                return (
                  <tr
                    key={member.id}
                    className={cn(
                      // The 44px pick cells already make the row 56px; the floor
                      // states the intent so a future cell change can't quietly
                      // drop below it.
                      "h-[54px] border-b border-line/70 last:border-b-0",
                      // Opaque, not `/50`. At 50% this composited to #FDF6F1 over
                      // the white panel while the sticky cell stayed #FCEDE3, and
                      // the mismatch read as a seam at the sticky edge.
                      isYou && "bg-brand-wash",
                    )}
                  >
                    {/* Rank + name + status — one sticky cell, deliberately.
                        Two sticky cells means hardcoding the second one's `left`
                        to the first one's rendered width, and that width is not
                        under our control: the trailing `Spacer` is `width: 100%`,
                        which in auto table layout squeezes every other column
                        toward its min-content size — measured: a `width: 36px`
                        column renders at 15.8px beside such a spacer, and at
                        exactly 36px without one. So the rank column rendered
                        narrower than the 36px the name column was pinned at,
                        leaving a transparent strip that scrolled cells showed
                        through. One cell has no offset to get wrong.
                        (Don't name the offending utility here — Tailwind scans
                        comments too and would emit it as dead CSS.) */}
                    <td
                      className={cn(
                        "sticky left-0 z-10 min-w-[11rem] border-r border-line px-2.5 py-2 align-middle",
                        stickyBg,
                        isYou && "border-l-2 border-brand-strong",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "w-5 shrink-0 text-center text-xs font-semibold tabular-nums",
                            eliminated ? "text-ink-mute" : "text-ink-soft",
                          )}
                        >
                          {rank}
                        </span>
                        <span
                          className={cn(
                            "truncate text-sm font-semibold",
                            eliminated ? "text-ink-mute" : "text-ink",
                          )}
                        >
                          {member.name}
                        </span>
                        {/* Beside the name rather than on its own line below, and
                            without the week it happened, which the row's own
                            washed cells already show. The ink is darkened from
                            `text-out`, which only reaches 3.5:1 on this wash;
                            #8A2C2C clears AA at 6.9 and is the same pair used for
                            pick errors. No Admin chip here — Who's In carries the
                            commissioner label. */}
                        {eliminated ? (
                          <Label className="shrink-0 rounded bg-out-wash px-1 text-[#8A2C2C]">
                            Out
                          </Label>
                        ) : null}
                      </div>
                    </td>

                    {/* Weekly picks */}
                    {weeks.map((col) => (
                      <td key={colKey(col)} className="px-1 py-1.5 text-center align-middle">
                        <WeekCell
                          cell={
                            col.preview
                              ? { kind: "empty" }
                              : cellFor(member, viewerId, col.week, currentWeek, gameForTeam, rules, now, hiddenSet)
                          }
                        />
                      </td>
                    ))}
                    <Spacer />
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

/**
 * A final, empty column that soaks up whatever width the real columns leave.
 *
 * Row rules are drawn on the `<tr>`, so they run exactly as far as the last cell
 * — which is why the header's underline used to stop mid-panel whenever the
 * columns didn't fill it, reading as a half-drawn table. `width: 100%` on an
 * auto-layout column claims all the slack, leaving every other column at its
 * natural size, so the rules reach the edge at any column count.
 */
function Spacer({ head = false }: { head?: boolean }) {
  return head ? <th aria-hidden className="w-full" /> : <td aria-hidden className="w-full" />;
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
      <span className="mx-auto grid h-11 w-11 place-items-center" aria-hidden>
        <span className="h-3 w-3 rounded-full border border-line/80" />
        <span className="sr-only">No pick</span>
      </span>
    );
  }

  if (cell.kind === "hidden") {
    return (
      <span
        className="mx-auto grid h-11 w-11 place-items-center rounded-lg bg-[#EEF1F6] text-ink-mute"
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
      className={cn("relative mx-auto grid h-11 w-11 place-items-center rounded-lg", wash)}
      title={team ? `${team.location} ${team.name}${resultLabel ? ` · ${resultLabel}` : ""}` : cell.teamId}
    >
      {/* Sized by prop, not class — TeamLogo writes an inline width/height that
          a Tailwind sizing utility would lose to. 36 in a 44px tile keeps the
          4px gutter the loss/push/live wash needs to read as a tile. */}
      <TeamLogo teamId={cell.teamId} size={36} />
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

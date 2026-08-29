"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import type { Game } from "@/lib/nfl/types";
import type { GroupRules, Member } from "@/lib/league/types";
import { cellFor, scrollLeftForWeek, type WeekCell } from "@/components/group/standings-grid";

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
 * The sticky name column's width, and the pitch of one week column, in px.
 *
 * Shared by the layout and by the auto-scroll arithmetic, which has to know
 * both to park the live week clear of the sticky edge. Two constants rather
 * than two magic numbers in three places: the scroll lands a column-width off
 * if either drifts, and nothing would throw.
 */
const NAME_COL_W = 146;
const WEEK_COL_W = 50;

/**
 * The season at a glance: one row per player, one column per week, each cell the
 * team they picked. Past weeks always show; the current week honors the per-game
 * privacy lock (a rival's pick is a padlock until that team's game kicks off).
 * Losses stay washed red for the rest of the season so strikes read straight
 * down a column; future weeks are hollow slots.
 *
 * All three standings surfaces render this one component — the signed-in
 * regular table, the preseason practice table and the anonymous landing board —
 * so anything changed here lands on all of them at once.
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
  // Guarded on !preview for the same reason the header chip is: the practice
  // table's currentWeek is a preseason week number, and a previewed
  // regular-season column of the same number is a different week entirely.
  const liveIndex = weeks.findIndex((c) => !c.preview && c.week === currentWeek);

  const scroller = useRef<HTMLDivElement | null>(null);
  /*
   * Open on the live week rather than on week 1.
   *
   * By week 10 the column anybody came to read is off the right edge on a
   * phone, and the table's first paint is a stretch of settled weeks. Assigned
   * directly rather than through `scrollTo({ behavior: "smooth" })`: this is
   * where the table STARTS, not a movement, and animating it would drag the
   * reader's eye across ten weeks of history on every load. That also means
   * `prefers-reduced-motion` needs no case here — there is no motion to reduce.
   *
   * A layout effect is not wanted either. This runs after paint, so the browser
   * has settled the auto table layout and `scrollWidth` is real; scrolling one
   * frame later is invisible, while measuring one frame early is wrong.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el || liveIndex < 0) return;
    el.scrollLeft = scrollLeftForWeek(liveIndex, NAME_COL_W, WEEK_COL_W);
  }, [liveIndex]);

  return (
    <div className="space-y-2">
      {/* Full-bleed below `lg`: the table is the widest thing on the page and
          the design gives it the whole viewport on phones and tablets, square
          corners and all, rather than a 16px-inset rounded card. The inset and
          the radius both come back at `lg`.

          The bleed sits on the Panel rather than this wrapper so the `Legend`
          below it — and the landing page's padlock note, which is a sibling of
          this whole component — stay lined up with the rest of the page.

          `-mx-4` assumes a `px-4` host, same as `StatusReport` above it: true of
          the app shell's `main` and of the landing page's own section.

          The side borders go with the inset, for the same reason the radius
          does: a border separates the card from the page, and at the screen edge
          there is no page left to separate it from. Both halves key off `lg`
          too, so there is no width where the table is inset but missing its
          sides.

          Do not "simplify" `border-x-0 … lg:border-x` into one class. It works
          by CSS source order, not by merging: `tailwind-merge` keeps `border`
          (from Panel's tone) *and* `border-x-0`, because only the all-sides
          group evicts the per-axis one and never the reverse. It resolves
          correctly because Tailwind emits the all-sides group ahead of
          `border-x`/`border-y`, and the `lg:` variant after every unprefixed
          utility. Rewrite it order-independently and it silently does nothing. */}
      <Panel
        tone="light"
        className="-mx-4 overflow-hidden rounded-none border-x-0 p-0 lg:mx-0 lg:rounded-card lg:border-x"
      >
        <div ref={scroller} className="overflow-x-auto scroll-none">
          {/* min-w-full so the table is never narrower than the panel; w-max so
              it still grows past it and scrolls once the columns need the room. */}
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-shell-line bg-white">
                {/* Rank and name share one cell — see the note on the body cell. */}
                <th
                  scope="col"
                  className="sticky left-0 z-20 w-[146px] min-w-[146px] border-r border-shell-line bg-white px-2 py-3.5 text-left"
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase text-ink-mute">
                    <span className="w-5 text-center">#</span>
                    <span>Name</span>
                  </span>
                </th>
                {weeks.map((col, i) => (
                  <th
                    key={colKey(col)}
                    scope="col"
                    className="w-[50px] min-w-[50px] p-0 text-center align-middle"
                  >
                    {/* The live week is an accent chip, every other week is bare
                        type. The chip is a child rather than a background on the
                        `th` so it can be inset from the column edges — a fill
                        that reached them would butt against its neighbours and
                        read as a merged band rather than one marked column.

                        Guarded on !preview: the practice grid's currentWeek is a
                        preseason week number, which a previewed regular-season
                        column of the same number would otherwise light up too. */}
                    {i === liveIndex ? (
                      <span className="mx-auto flex h-8 w-[46px] items-center justify-center rounded bg-accent text-[12px] font-semibold uppercase tabular-nums text-white">
                        {col.label}
                      </span>
                    ) : (
                      <span className="flex h-8 items-center justify-center px-0.5 text-[12px] font-semibold uppercase tabular-nums text-ink-mute">
                        {col.label}
                      </span>
                    )}
                  </th>
                ))}
                <Spacer head />
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ member, rank }, i) => {
                const isYou = member.id === viewerId;
                const eliminated = member.status === "eliminated";
                /*
                 * Zebra stripes replace the row rules the table used to draw.
                 * Keyed off the RENDERED index rather than the rank so the
                 * alternation never breaks — they are the same number today,
                 * and would stop being if a row were ever filtered out.
                 *
                 * The signed-in viewer's row takes the highlight INSTEAD of its
                 * stripe rather than on top of it: one class from one ternary,
                 * because every fill here lands in tailwind-merge's single
                 * background-colour group and emitting two would silently drop
                 * one by argument order — the trap `WeekStrip` records.
                 *
                 * All three are opaque, and that is not a preference. The first
                 * cell of the row is sticky, so a translucent fill lets the week
                 * cells scrolling underneath show straight through it.
                 *
                 * An eliminated row is NOT faded or tinted. Where it sits is the
                 * statement — the dead block is frozen in elimination order, so
                 * scrolling down it reads the season backwards — and the red
                 * tile on the week they went out is what marks the loss.
                 */
                const rowBg = isYou ? "bg-ink-wash" : i % 2 === 0 ? "bg-fill-stripe" : "bg-white";
                return (
                  <tr key={member.id} className={cn("h-12", rowBg)}>
                    {/* Rank + name — one sticky cell, deliberately.
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
                        "sticky left-0 z-10 w-[146px] min-w-[146px] border-r border-shell-line px-2 align-middle",
                        rowBg,
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 shrink-0 text-center text-[12px] font-medium tabular-nums text-ink-soft">
                          {rank}
                        </span>
                        <span className="truncate text-sm font-semibold text-ink">
                          {member.name}
                        </span>
                        {/* The "Out" chip is gone with the redesign — the frame
                            has no room for one at this row height and the frozen
                            position below the living says it instead. Position
                            is not available to a screen reader, though, so the
                            fact is stated here rather than left to sighted
                            readers alone. */}
                        {eliminated ? <span className="sr-only">Eliminated</span> : null}
                      </div>
                    </td>

                    {/* Weekly picks */}
                    {weeks.map((col) => (
                      <td
                        key={colKey(col)}
                        className="w-[50px] min-w-[50px] p-0 text-center align-middle"
                      >
                        <WeekCellView
                          cell={
                            col.preview
                              ? { kind: "empty" }
                              : cellFor(
                                  member,
                                  viewerId,
                                  col.week,
                                  currentWeek,
                                  gameForTeam,
                                  rules,
                                  now,
                                  hiddenSet,
                                )
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
 * Row fills are painted on the `<tr>`, so they run exactly as far as the last
 * cell — which is why a row's stripe would otherwise stop mid-panel whenever the
 * columns didn't fill it, reading as a half-drawn table. `width: 100%` on an
 * auto-layout column claims all the slack, leaving every other column at its
 * natural size, so the fills reach the edge at any column count.
 */
function Spacer({ head = false }: { head?: boolean }) {
  return head ? <th aria-hidden className="w-full" /> : <td aria-hidden className="w-full" />;
}

// ── Cells ────────────────────────────────────────────────────────────────────

/**
 * The tile the logo, lock or hollow slot sits in — 48px square, centred in its
 * 50px column so neighbouring tiles clear each other by 2px.
 */
const TILE = "mx-auto grid h-12 w-12 place-items-center";

/**
 * The tinted box behind a logo on a settled week: 42px inside the 48px tile, so
 * the tint reads as a marked square with the logo sitting in it rather than as a
 * full-bleed cell fill.
 *
 * All three fills come from ONE lookup for the reason the row fill does — two
 * background classes on one element resolve by tailwind-merge's argument order,
 * silently. The two result tokens are 6-digit hexes precisely so these opacity
 * modifiers work on them.
 */
const RESULT_BOX: Record<"win" | "loss" | "push", string> = {
  win: "bg-result-win-fill/40",
  loss: "bg-result-loss-fill-deep/[0.22]",
  // The design covers win and loss only. A push survives, and this blue is the
  // treatment the table has always given one — kept rather than folded into the
  // win green, because a tie is a different fact and only some leagues let it
  // save you.
  push: "bg-[#E7EEF6]",
};

function WeekCellView({ cell }: { cell: WeekCell }) {
  if (cell.kind === "empty") {
    return (
      <span className={TILE}>
        <span className="h-3 w-3 rounded-full border border-shell-dark" aria-hidden />
        <span className="sr-only">No pick</span>
      </span>
    );
  }

  if (cell.kind === "hidden") {
    return (
      <span className={TILE} title="Hidden until kickoff">
        <span className="grid h-8 w-8 place-items-center rounded bg-[#EEF1F6] text-ink-mute">
          <LockIcon className="h-4 w-4" />
        </span>
        <span className="sr-only">Pick hidden until kickoff</span>
      </span>
    );
  }

  const team = getTeam(cell.teamId);
  const box = cell.result ? RESULT_BOX[cell.result] : "";
  const resultLabel = cell.result ?? (cell.live ? "live" : "");

  return (
    <span
      className={cn("relative", TILE)}
      title={
        team ? `${team.location} ${team.name}${resultLabel ? ` · ${resultLabel}` : ""}` : cell.teamId
      }
    >
      {/* Sized by prop, not class — TeamLogo writes an inline width/height that
          a Tailwind sizing utility would lose to. 34 inside a 42px box inside a
          48px tile is the frame's own nesting, and the gutter is what makes the
          tint read as a tile rather than as a block of colour.

          The box being WIDER than the logo is what keeps this safe: preflight's
          `img { max-width: 100% }` outranks that inline width, so a container
          narrower than the logo silently shrinks it. TeamLogo carries
          `max-w-none` for exactly that reason — see the trap in CLAUDE.md.

          No blend mode over the tint. One was tried on the week strip's chips
          and erased every light-marked team's artwork — Saints gold, the Colts'
          white horseshoe — which is a far worse failure than a logo reading a
          shade bright on a wash. */}
      <span className={cn("grid h-[42px] w-[42px] place-items-center rounded", box)}>
        <TeamLogo teamId={cell.teamId} size={34} />
      </span>
      {cell.live ? (
        <span className="absolute right-0.5 top-0.5 flex h-2 w-2">
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
        <span className={cn("h-3 w-3 rounded", RESULT_BOX.loss)} /> Loss
      </span>
      {/* New with the redesign. A win used to be painted as nothing at all, so
          there was no swatch to explain; it is now tinted for the week being
          played and goes plain once the week settles, which is what keeps a
          long season from turning into a wall of green. */}
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-3 w-3 rounded", RESULT_BOX.win)} /> Win
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-3 w-3 rounded", RESULT_BOX.push)} /> Push
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LockIcon className="h-3.5 w-3.5" /> Hidden until kickoff
      </span>
      {/* No "Upcoming" row. The hollow circle it described is still what an
          `empty` cell draws, but it is the absence of a pick rather than a
          state of its own — and "Upcoming" was the wrong word for it anyway,
          since the same glyph marks a week that has been and gone unpicked.
          The cell carries `sr-only` "No pick", which is the accurate reading. */}
    </div>
  );
}

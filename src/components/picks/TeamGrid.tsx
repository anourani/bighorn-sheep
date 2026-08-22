"use client";

import { useRef } from "react";

import { cn } from "@/lib/cn";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { weekKey, type WeekRef } from "@/lib/nfl/calendar";
import type { Game, TeamId } from "@/lib/nfl/types";
import type { TeamRecord } from "@/lib/league/types";
import { formatRecord } from "@/lib/league/records";
import {
  buildGridCards,
  cardAriaLabel,
  cardSubtitle,
  cardTitle,
  orderGridTeams,
  type GridCard,
} from "@/components/picks/team-grid";
import { useCardReveal } from "@/components/picks/use-card-reveal";
import { REVEAL_CLIP } from "@/components/picks/card-reveal";
import type { UsedPick } from "@/components/picks/WeekSchedule";

/**
 * All 32 teams as a grid of cards — the alternative to the matchup list, and
 * the default. One tap picks; the matchup layout is one tap away in the filters.
 *
 * The geometry is exact rather than approximate, and both ends come straight off
 * the mockups: six 154px cards with 8px gutters inside the 968px column
 * (`max-w-shell` minus the shell's `px-4`), and three cards edge-to-edge on a
 * 393px phone with 4px of everything. `-mx-4` cancelling the host's inset is the
 * same full-bleed idiom `StandingsGrid` and `StatusReport` use, and it assumes,
 * as they do, that the host supplies exactly 16px.
 *
 * Column count steps more than once on the way between them: three across is a
 * phone layout, and holding it to `lg` would draw 328px cards on a tablet.
 * `lg` is still where the *shape* turns over — it is where the grid stops
 * bleeding and the page as a whole changes.
 *
 * Every availability decision is made in `team-grid.ts` off the same values the
 * matchup layout is handed, so the two surfaces cannot disagree about what is
 * pickable.
 */
export function TeamGrid({
  weekRef,
  weekName,
  games,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  records,
  onSelect,
}: {
  weekRef: WeekRef;
  weekName: string;
  games: Game[];
  usedByTeam: Map<TeamId, UsedPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  records: Map<TeamId, TeamRecord>;
  onSelect: (teamId: TeamId) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);

  // Hoisted above the empty-week return below, and that is not a style choice:
  // a hook placed after a conditional return stops being called the moment you
  // select a week whose schedule hasn't been released, which React reports as
  // "rendered fewer hooks than expected" and `/app/error.tsx` catches as a
  // broken screen. Building 32 bye cards for an empty week costs nothing —
  // `buildGridCards` loops TEAMS either way.
  const cards = buildGridCards({ games, usedByTeam, selectedTeam, interactive, now });
  const order = orderGridTeams(cards, (id) => records.get(id) ?? { w: 0, l: 0, t: 0 });

  // Two keys, because the reveal treats the two kinds of change differently: a
  // new week is the one thing that animates the cards again, while a re-order
  // only rebuilds the cascade arithmetic in silence.
  //
  // `orderKey` is the order itself rather than the inputs to it. It covered the
  // Sort filter as well as the record ranking; with the filter gone the ranking
  // is all that is left, and records only move across weeks — so this is now a
  // subset of `weekKey` rather than an independent trigger. Kept anyway: it
  // costs one string compare, and it is the honest key for "the order changed"
  // if anything ever reorders within a week again. Deliberately NOT keyed on the
  // pick: `orderGridTeams` passes `groupUnavailable: false`, which skips the
  // actionable-first branch, so the comparator reads records and kickoffs only
  // and the order does not move when you tap a team. Keying on `cards` would
  // rebuild 32 timelines on every pick.
  // `REVEAL_CLIP`: the curtain wipe, unchanged. The matchup layout next door
  // takes `REVEAL_FADE` instead — a card here is a 155px square of logo whose
  // whole read is its edge landing, and a blur costs it that.
  useCardReveal(grid, {
    reveal: REVEAL_CLIP,
    weekKey: weekKey(weekRef),
    orderKey: order.join(","),
  });

  // A week with no schedule is not 32 byes — say so, exactly as the matchup
  // layout does, rather than drawing a full grid of dead cards.
  if (games.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-line bg-[#FAFAFB] px-3 py-8 text-center text-sm text-ink-mute">
        Schedule not yet released for {weekName}.
      </div>
    );
  }

  const groupName = `${weekKey(weekRef)}-grid-pick`;

  return (
    // `min-w-0`: a fieldset's UA `min-inline-size: min-content` is not something
    // preflight resets, and it will happily push a grid past its column.
    <fieldset className="min-w-0">
      <legend className="sr-only">Pick your {weekName} team</legend>
      <div
        ref={grid}
        className="-mx-4 grid grid-cols-3 gap-1 px-1 min-[480px]:grid-cols-4 md:grid-cols-5 lg:mx-0 lg:grid-cols-6 lg:gap-2 lg:px-0"
      >
        {order.map((teamId) => {
          const card = cards.get(teamId);
          if (!card) return null;
          return (
            <TeamCard
              key={teamId}
              card={card}
              groupName={groupName}
              record={formatRecord(records.get(teamId))}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function TeamCard({
  card,
  groupName,
  record,
  onSelect,
}: {
  card: GridCard;
  groupName: string;
  record: string;
  onSelect: (teamId: TeamId) => void;
}) {
  const { state, selectable, team, teamId } = card;
  const selected = state === "selected";
  const outOfPlay = state === "used" || state === "bye" || state === "locked";

  return (
    <label
      className={cn(
        // Both the masked start state and how `useCardReveal` finds the cards —
        // a direct child of the grid div above. Read off the same object the
        // hook was handed, so the class and the styles cannot disagree.
        REVEAL_CLIP.className,
        "group relative flex aspect-square flex-col items-center px-1 pb-2 lg:px-2 lg:pb-3",
        "transition-[background-color,border-radius,box-shadow] duration-150",
        selectable ? "cursor-pointer" : "cursor-not-allowed",
        // The radius grows with the state — 2px at rest, 4px under the pointer,
        // 8px once it is your pick.
        //
        // An inset ring rather than a border for the selected edge. A 2px border
        // is inside the card either way (preflight sets border-box, so the card
        // still sits on the grid's column) — but it is inside the *content* box
        // too, which took 4px off the width the logo is sized from and shrank it
        // the moment you picked it. A ring is a box-shadow: same 2px stroke just
        // inside the same radius, and it costs no layout at all.
        selected
          ? "rounded-control bg-accent-faded ring-2 ring-inset ring-accent"
          : outOfPlay
            ? "rounded-sm bg-fill-soft/50 opacity-70"
            : "rounded-sm bg-fill-soft",
        selectable &&
          !selected &&
          "[@media(hover:hover)]:hover:rounded [@media(hover:hover)]:hover:bg-white",
      )}
    >
      <input
        type="radio"
        name={groupName}
        className="peer sr-only"
        checked={selected}
        disabled={!selectable}
        onChange={() => selectable && onSelect(teamId)}
        aria-label={cardAriaLabel(card, record)}
      />

      <span
        aria-hidden
        className="absolute right-1.5 top-1.5 text-[10px] font-semibold leading-[0.9] tracking-[-0.2px] tabular-nums text-shell-mute lg:right-2 lg:top-2"
      >
        {record}
      </span>

      {/* Colour is the reward for reaching a card you can act on: every logo is
          greyscale at rest and comes up in team colours under the pointer, and
          stays in colour once picked. Figma reaches it with
          `mix-blend-luminosity`; over a neutral card that is the same picture as
          a grayscale filter, without the isolation and stacking-context rules a
          blend mode drags in. */}
      <span
        className={cn(
          "flex min-h-0 w-full flex-1 items-center justify-center px-5 pb-1 pt-3 lg:items-end lg:px-6 lg:pt-2",
          !selected && "grayscale",
          selectable && "[@media(hover:hover)]:group-hover:grayscale-0",
        )}
      >
        {/* `fill`, not a pixel size: on desktop the logo is sized off the column,
            and `size` is an inline style no breakpoint class can reach. `size`
            here only scales the fallback tile's abbreviation. */}
        <TeamLogo teamId={teamId} size={64} fill className="max-h-16 lg:max-h-none" />
      </span>

      <span className="w-full truncate text-center text-[12px] font-medium leading-[1.2] tracking-[-0.24px] text-shell-ink">
        {cardTitle(team)}
      </span>
      <span className="mt-0.5 w-full truncate text-center text-[10px] font-medium leading-[1.2] tracking-[-0.2px] text-shell-mute">
        {cardSubtitle(card)}
      </span>

      {/* The focus ring, drawn on an overlay because the real input is sr-only
          and its own ring is clipped away. `ring-inset`: the global ring sits 4px
          outside the box, which on a phone is the entire margin between the card
          and the edge of the screen — outside it, the body scrolls sideways. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-brand-strong"
      />
    </label>
  );
}

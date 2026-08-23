"use client";

import { useRef } from "react";

import { cn } from "@/lib/cn";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { LockIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { weekKey, type WeekRef } from "@/lib/nfl/calendar";
import { isHome } from "@/lib/league/view";
import { useCardReveal } from "@/components/picks/use-card-reveal";
import { REVEAL_FADE } from "@/components/picks/card-reveal";

/**
 * A team already spent, and the week it went. Only the week is needed — a pick
 * whose game hasn't finished still spends its team, so requiring a resolved
 * `result` here would silently omit unresolved picks from the used list.
 */
export interface UsedPick {
  week: number;
}

/**
 * The week's matchups as a radio group — one pick per week across every game.
 * Selecting a team's radio sets the pick immediately (editable until that game
 * kicks off). Teams already used this season, teams whose game has kicked off,
 * and every team while browsing a non-current week are shown but not selectable.
 *
 * `weekRef` identifies the week including its phase, so preseason week 2 and
 * regular week 2 get distinct radio-group names and distinct copy. `weekName` is
 * the already-formatted label ("Week 2", "Preseason 2", "Hall of Fame") — passed
 * in rather than derived here, because only the caller knows how many preseason
 * weeks the loaded schedule has.
 */
export function WeekSchedule({
  weekRef,
  weekName,
  games,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  onSelect,
}: {
  weekRef: WeekRef;
  weekName: string;
  games: Game[];
  usedByTeam: Map<TeamId, UsedPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  onSelect: (teamId: TeamId) => void;
}) {
  // The fieldset below IS the grid, so that is what the reveal measures — and
  // its first DOM child is the `<legend>`, which is why `useCardReveal` finds
  // cards by class rather than by walking `.children`. Above the early return,
  // because hooks are.
  const grid = useRef<HTMLFieldSetElement>(null);
  // `orderKey` is the game ids, which is what the cards below are keyed by — so
  // it changes exactly when React replaces the children. Length alone would not:
  // two weeks can carry the same number of games, and every ScrollTrigger would
  // then be pointing at a detached element.
  //
  // Those ids are globally unique per game, so a week change replaces every card
  // node here where `TeamGrid` keeps all 32 of its labels. The reveal handles
  // that — a card mounted a moment ago has nothing to fade away, so on this
  // surface a week change fades in without fading out first.
  //
  // `REVEAL_FADE` and not `REVEAL_CLIP`: this layout arrives out of a blur, the
  // way the pick module above it resolves itself, where the team grid keeps the
  // curtain wipe. Same object supplies the cards' class below, so the two halves
  // of that choice cannot come apart.
  useCardReveal(grid, {
    reveal: REVEAL_FADE,
    weekKey: weekKey(weekRef),
    orderKey: games.map((game) => game.id).join(","),
  });

  if (games.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-line bg-[#FAFAFB] px-3 py-8 text-center text-sm text-ink-mute">
        Schedule not yet released for {weekName}.
      </div>
    );
  }

  const groupName = `${weekKey(weekRef)}-pick`;
  return (
    <fieldset
      ref={grid}
      className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
    >
      <legend className="sr-only">Pick your {weekName} team</legend>
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          groupName={groupName}
          usedByTeam={usedByTeam}
          selectedTeam={selectedTeam}
          interactive={interactive}
          now={now}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}

function GameCard({
  game,
  groupName,
  usedByTeam,
  selectedTeam,
  interactive,
  now,
  onSelect,
}: {
  game: Game;
  groupName: string;
  usedByTeam: Map<TeamId, UsedPick>;
  selectedTeam: TeamId | null;
  interactive: boolean;
  now: Date;
  onSelect: (teamId: TeamId) => void;
}) {
  const kicked = isKickedOff(game, now);
  // Whether the week's pick is one of THIS card's two teams — the card wears the
  // accent edge, not the row. Cheap enough to derive here rather than thread down:
  // `TeamOption` already gets the per-row answer as `selected`.
  const selectedHere = selectedTeam === game.home || selectedTeam === game.away;
  // Home team first, then away — mirrors the matchup layout on the pick screen.
  const order: TeamId[] = [game.home, game.away];

  return (
    // The reveal's class sits on this wrapper and NOT on the card below it. That
    // is load-bearing: `useCardReveal` queries `:scope > .{className}`, i.e.
    // direct children of the fieldset only. Push the class down onto the card
    // and the query matches nothing, the hook returns early before writing a
    // single style, and `globals.css` leaves every card blurred out at opacity
    // 0 — a permanently blank matchup grid, with nothing thrown and both
    // typecheck and the test suite still green. The hook warns about that in
    // development now, which is the only reason it is not still silent.
    //
    // Taken off `REVEAL_FADE` rather than typed, so it cannot disagree with the
    // reveal handed to the hook above.
    //
    // So the kickoff line rides inside the fade along with the card, which is
    // also the honest reading: the two are one module and arrive together.
    <div className={REVEAL_FADE.className}>
      {/* The kickoff sits ABOVE the card now, on the page background — date on
          the left, clock (and the lock badge once it applies) on the right.
          `items-baseline` puts the two halves on one line; `flex-wrap` lets the
          clock drop to a second line on a narrow column rather than crushing
          the date, which is the case the old single-line format hit constantly. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 pb-2">
        <LocalTime
          iso={game.kickoff}
          mode="weekdaydate"
          className="text-[11px] font-semibold leading-snug tabular-nums text-ink-mute"
        />
        {/* `items-center`, NOT `items-baseline`: the badge is an inline-flex box
            whose 14.5px line-height baseline sits below the clock's 15.125px one,
            which grew this header by 2.25px and pushed the grey card 2.25px below
            its badge-less neighbours in the same grid row. Measured, not reasoned
            about — 23.13 / 25.38 / 23.13px across three cards. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <LocalTime
            iso={game.kickoff}
            mode="clockzone"
            className="text-[11px] font-semibold leading-snug tabular-nums text-ink-mute"
          />
          {kicked ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase leading-[1.45] tracking-wide text-ink-mute">
              <LockIcon className="h-3 w-3" />
              {game.status === "final" ? "Final" : game.status === "in_progress" ? "Live" : "Locked"}
            </span>
          ) : null}
        </span>
      </div>

      {/* No top padding of its own: the header left the card, so the rows' own
          `py-2.5` is the whole inset.

          White while the game is open, grey once it locks — so "you can act on
          this" is carried by the card itself rather than by a hover the touch
          devices never get. `kicked` alone is the test, matching the lock badge
          in the header directly above (which is also ungated by `interactive`)
          and the request's own words, "ongoing or in the past". The accepted
          consequence: a FUTURE preview week draws white cards nothing can be
          picked from. The row caption below splits the other way — `kicked &&
          interactive` — which is the same tension this file already carried.

          The accent edge is a BORDER plus an OUTSET ring, and neither half is
          arbitrary. `ring-inset` is what `TeamGrid` uses, and it would be painted
          over here: an inset box-shadow draws above the element's own background
          but below its descendants', and the picked row's opaque `bg-brand-wash`
          spans the full width, so it would cover the ring along that row's left
          and right edges. `border-2` would read right and cost 2px of height plus
          1px of inset on every row, so the card twitches as you tap along it. A
          1px border with a 1px ring outside it reads as the same 2px edge and
          costs no layout at all, because a ring is a box-shadow. */}
      <div
        className={cn(
          // The property list is spelled out because `transition-colors` does NOT
          // include `box-shadow`, and the ring outside the border IS a box-shadow
          // — so the two halves of one 2px accent edge would arrive at different
          // rates, the border fading over 150ms while the ring snapped in.
          "overflow-hidden rounded-control border",
          "transition-[background-color,border-color,box-shadow]",
          kicked ? "bg-[#F6F6F6]" : "bg-white",
          selectedHere ? "border-accent ring-1 ring-accent" : "border-line",
        )}
      >
        <div className="divide-y divide-line/70">
          {order.map((teamId) => (
            <TeamOption
              key={teamId}
              teamId={teamId}
              game={game}
              groupName={groupName}
              used={usedByTeam.get(teamId)}
              selected={selectedTeam === teamId}
              interactive={interactive}
              kicked={kicked}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamOption({
  teamId,
  game,
  groupName,
  used,
  selected,
  interactive,
  kicked,
  onSelect,
}: {
  teamId: TeamId;
  game: Game;
  groupName: string;
  used: UsedPick | undefined;
  selected: boolean;
  interactive: boolean;
  kicked: boolean;
  onSelect: (teamId: TeamId) => void;
}) {
  // Not `getTeam(teamId)!`. games.home/away are bare text with no foreign key, so
  // a feed change or a bad manual row can carry a code that isn't one of the 32 —
  // and the non-null assertion turned that single row into a blank picks page for
  // everyone. The importer validates codes on the way in; this is the backstop for
  // anything already stored. Render the row as unpickable rather than crashing.
  const team = getTeam(teamId);
  if (!team) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-mute">
        <span className="text-[10px] font-semibold uppercase tracking-wide">{teamId || "unknown"}</span>
        <span className="text-xs">Unrecognized team — not pickable.</span>
      </div>
    );
  }

  const home = isHome(game, teamId);
  const selectable = interactive && !used && !kicked;

  // The design library's Radio has a `Disabled?` variant, and the two halves of a
  // locked card answer it differently — which is the mock-up's own reading: your
  // pick stays accent on a game that has already kicked off, and only the team
  // you passed on goes grey. So an UNCHECKED radio is disabled the moment its row
  // stops being pickable, while a CHECKED one holds its colour until the WEEK
  // itself is a preview, where every pick on screen is a record rather than a
  // choice. Same asymmetry `detail` draws just below with `kicked && interactive`.
  const radioDisabled = selected ? !interactive : !selectable;

  const detail = used
    ? `Used · W${used.week}`
    : kicked && interactive
      ? "Locked"
      : home
        ? "Home"
        : "Away";

  // `selected` first: on a week you are only previewing, your own pick is not
  // selectable, and announcing it as "not selectable" buries the one fact that
  // matters — that this is the team you went with.
  const label = selected
    ? `${team.name}, your pick`
    : used
      ? `${team.name}, already used in Week ${used.week}`
      : !selectable
        ? `${team.name}, not selectable`
        : `Pick the ${team.name}`;

  return (
    <label
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 transition-colors",
        // A row is only ever selectable on a card that is now WHITE, so the hover
        // has to be re-tuned against white rather than the old #F6F6F6: #EFEFEF
        // was a 7-unit step down from that fill and would be a 16-unit one from
        // white, more than twice the contrast it was drawn at. `fill-raised` is
        // 5 units, the nearest real token, and retires a hardcoded hex with it.
        selectable ? "cursor-pointer hover:bg-fill-raised" : "cursor-not-allowed",
        selected && "bg-brand-wash",
      )}
    >
      <input
        type="radio"
        name={groupName}
        className="peer sr-only"
        checked={selected}
        disabled={!selectable}
        onChange={() => selectable && onSelect(teamId)}
        aria-label={label}
      />

      <TeamLogo teamId={teamId} size="md" className={cn(used && "opacity-40")} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              // No accent ink on the picked team: selection is already said three
              // ways — the row's wash, the card's accent edge, and the radio — and
              // a fourth left the two teams' names set in different colours for a
              // fact neither of them is about.
              "truncate text-sm font-semibold",
              used ? "text-ink-mute line-through" : "text-ink",
            )}
          >
            {team.name}
          </span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-mute">
            {team.abbr}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs",
            used ? "text-out/80" : "text-ink-soft",
          )}
        >
          {detail}
        </span>
      </span>

      {/* Custom radio, driven by React state; the real input above stays for a11y.

          The design library's four states, transcribed: a 16px ring at 1px, and a
          10px dot inside it when checked (Figma insets the dot 18.75% a side,
          which is 3px of 16). Every colour lands on a token that already exists at
          exactly the spec's hex — `accent` #FC5F38, `shell-ink` #1E1E1E,
          `fill-soft` #F3F3F3, `shell-dark` #A5ACAF — so nothing new was added to
          the config for this.

          What it replaces was a 20px ring whose "checked" state was a 6px BORDER
          closing over the middle, plus `opacity-40` to stand in for disabled. The
          dot is a real element now and disabled is two real tokens, so a greyed
          radio is the design's grey rather than the enabled one faded out.

          The 4px it loses costs no row height: this is the shortest thing in a
          `flex items-center` row whose text column runs ~38px and whose logo is
          36px. And the tap target was never this box — it is the whole label. */}
      <span
        aria-hidden
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/60 peer-focus-visible:ring-offset-1",
          radioDisabled
            ? "border-shell-dark bg-fill-soft"
            : selected
              ? "border-accent bg-white"
              : "border-shell-ink bg-white",
        )}
      >
        {/* Always mounted, scaled to nothing when unchecked, so it resolves over
            the same 150ms as the ring's border colour instead of popping in a
            frame ahead of it. `transform` has to be NAMED — `transition-colors`
            would leave the scale instant and reintroduce the pop. The dot sits in
            a fixed 16px grid cell, so a scaled-away one moves no layout. */}
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full transition-[transform,background-color]",
            selected ? "scale-100" : "scale-0",
            radioDisabled ? "bg-shell-dark" : "bg-accent",
          )}
        />
      </span>
    </label>
  );
}

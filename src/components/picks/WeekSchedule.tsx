"use client";

import { Fragment, useRef } from "react";

import { cn } from "@/lib/cn";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { weekKey, type WeekRef } from "@/lib/nfl/calendar";
import { isHome, teamScoreline } from "@/lib/league/view";
import { useCardReveal } from "@/components/picks/use-card-reveal";
import { REVEAL_FADE } from "@/components/picks/card-reveal";
import { gameClockLabel } from "@/components/picks/game-clock";

/**
 * The card's meta type, off the design's `Body 12`: the header line and each
 * row's Home/Away caption are the same thing said in two places, so they share
 * one string rather than drifting apart a tracking value at a time.
 */
const META = "text-[12px] font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute";

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
 * kicks off). Teams already spent this season, teams whose game has kicked off,
 * and every team on a week already played are shown but not selectable. A week
 * ahead of the live one IS selectable — that is picking ahead.
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
  // Null for anything that has not been played, which is what selects the
  // kickoff-time fallback in the header below.
  const liveClock = gameClockLabel(game);
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
      {/* The kickoff sits ABOVE the card, on the page background — date on the
          left, the game's own clock (and the lock word once it applies) on the
          right. `items-baseline` puts the two halves on one line; `flex-wrap`
          lets the clock drop to a second line on a narrow column rather than
          crushing the date.

          `items-center` on the right group used to carry a warning: a 10px
          uppercase badge's baseline sat below the 11px clock's and pushed this
          card 2.25px below its badge-less neighbours in the same grid row. Every
          span in here is one 12px/1.4 face now, so the baselines agree by
          construction and there is nothing left for that bug to bite. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 pb-1">
        <LocalTime iso={game.kickoff} mode="weekdaydate" className={META} />
        <span className="flex shrink-0 items-center gap-2">
          {/* The clock slot answers with the GAME when the game has something to
              say — "2Q 4:31", "Halftime", "Final/OT" — and with the kickoff time
              otherwise. `gameClockLabel` returning null is what selects the
              fallback, so a feed that goes quiet degrades to the schedule rather
              than to an empty slot. It needs no `LocalTime`: a period and a game
              clock are facts about the game, not about the reader's timezone, so
              this half of the line renders on the server and never swaps. */}
          {liveClock ? (
            <span className={cn(META, "tabular-nums")}>{liveClock}</span>
          ) : (
            <LocalTime iso={game.kickoff} mode="clockzone" className={cn(META, "tabular-nums")} />
          )}
          {/* "Locked" is about your PICK, which is why the design keeps printing
              it over a game that is still being played — the clock slot beside it
              is what carries whether the game is live or done. No icon and no
              uppercase: it is the same meta face as everything else on this line. */}
          {kicked ? <span className={META}>Locked</span> : null}
        </span>
      </div>

      {/* `p-1` insets the rows by 4px, and that one number pays for two things
          the old card needed: `overflow-hidden` is gone, because no row reaches
          the corners to be clipped any more, and so is the outset ring that stood
          in for a 2px edge. The design's accent edge is a plain 1px border, and
          with nothing full-bleed inside the card there is no longer a descendant
          background that could paint over one.

          White while the game is open, grey once it locks — so "you can act on
          this" is carried by the card itself rather than by a hover the touch
          devices never get. `kicked` alone is the test, matching the lock word in
          the header above it and the request's own words, "ongoing or in the
          past". A future week therefore draws white cards, which is now simply
          true of them: nothing there has kicked off and every one is pickable.
          (It used to be an accepted cost — white cards nothing could be picked
          from — and the radios were the only thing saying so.) A week already
          played draws grey ones, and its radios are what say you cannot act
          there. Lock state is stated exactly once on this card, in the header;
          the rows below stayed positional, Home and Away, in every state.

          Selected is a WHITE card behind an accent edge, and the tint is stated
          exactly once, on the picked row inside it. The card used to carry the
          faded accent too and the row doubled it — 8% over 8% over white, ~15%
          — which the design has since dropped in favour of the single layer:
          the edge is what says "this matchup holds your pick" and the one tinted
          row says which half of it. So the selected branch keeps its own
          `bg-white` rather than folding into the unselected one: a selected card
          stays white even after kickoff, which is the state the frame draws
          (a locked game, with scores, on white). Half the old warning survives
          and still matters — there is no second, darker accent token to reach
          for, and the faded one is an 8-digit hex whose alpha an `/opacity`
          modifier cannot touch. */}
      <div
        className={cn(
          "flex flex-col rounded-control border p-1 transition-[background-color,border-color]",
          selectedHere
            ? "border-accent bg-white"
            : cn("border-shell-line", kicked ? "bg-[#F6F6F6]" : "bg-white"),
        )}
      >
        {order.map((teamId, index) => (
          <Fragment key={teamId}>
            {/* A real element rather than `divide-y`, because the design HIDES
                this line on the selected card and a divide utility has no state
                to hang that on. `opacity-0` and not an unmount: the row keeps its
                1px, so the card is exactly as tall picked as unpicked and nothing
                shifts under your finger as you tap along the week. */}
            {index > 0 ? (
              <div
                aria-hidden
                className={cn(
                  "h-px w-full bg-shell-line transition-opacity",
                  selectedHere && "opacity-0",
                )}
              />
            ) : null}
            <TeamOption
              teamId={teamId}
              game={game}
              groupName={groupName}
              used={usedByTeam.get(teamId)}
              selected={selectedTeam === teamId}
              cardSelected={selectedHere}
              interactive={interactive}
              kicked={kicked}
              onSelect={onSelect}
            />
          </Fragment>
        ))}
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
  cardSelected,
  interactive,
  kicked,
  onSelect,
}: {
  teamId: TeamId;
  game: Game;
  groupName: string;
  used: UsedPick | undefined;
  selected: boolean;
  /** Whether the PICK is one of this card's two teams — not just this row. */
  cardSelected: boolean;
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
      <div className="flex items-center gap-3 rounded-control p-2 text-sm text-ink-mute">
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

  // `teamScoreline` rather than `isHome(...) ? game.homeScore : game.awayScore`:
  // it null-guards BOTH scores together, so a half-written row can never print
  // one team's points beside the other team's blank. Null until the scorer has
  // run, which is also why a game that has not kicked off needs no explicit gate
  // to hide the column — the design simply has no score node in that state.
  const score = teamScoreline(game, teamId)?.for ?? null;

  // Home/Away survives a kickoff, and all three designed states say so: the two
  // LOCKED ones keep the positional label rather than swapping it for the word
  // "Locked". This used to override it on the live week, which both contradicted
  // the design and said a second time what the card header already says beside
  // the clock — spending the one fact only this row can carry to repeat the one
  // fact the line above it already carried.
  //
  // `Used · W3` is a different kind of override and stays: nothing else on the
  // card carries it, it is the only explanation of why a team on an open white
  // card cannot be picked, and no designed state contradicts it — none of the
  // three shows a spent team.
  const detail = used ? `Used · W${used.week}` : home ? "Home" : "Away";

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
        "flex items-center justify-between gap-3 rounded-control p-2 transition-colors",
        // A row is only ever selectable on a card that is WHITE, so the hover is
        // tuned against white rather than the old #F6F6F6 fill: #EFEFEF was a
        // 7-unit step down from that and would be a 16-unit one from white, more
        // than twice the contrast it was drawn at. `fill-raised` is 5 units, the
        // nearest real token, and retires a hardcoded hex with it.
        selectable ? "cursor-pointer hover:bg-fill-raised" : "cursor-not-allowed",
        // The only accent fill on the card now: 8% over the card's white, rather
        // than the second of two stacked layers it used to be. See the card's
        // comment above for why that changed and what it is still carrying.
        selected && "bg-accent-faded",
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

      <span className="flex min-w-0 items-center gap-3">
        <TeamLogo teamId={teamId} size="md" className={cn(used && "opacity-40")} />

        <span className="min-w-0">
          <span
            className={cn(
              // The design's `Body SemiB 18`. No accent ink on the picked team:
              // selection is already said by the card's edge, the card's tint, the
              // row's deeper tint and the radio, and a fifth signal left the two
              // teams' names set in different colours for a fact neither is about.
              "block truncate text-[18px] font-semibold leading-[1.2] tracking-[-0.18px]",
              used ? "text-shell-mute line-through" : "text-shell-ink",
            )}
          >
            {team.name}
          </span>
          {/* The `CIN` / `BUF` chip that sat beside the name is gone — it is in
              none of the three designed states, and at 18px the name no longer
              needs a second identifier to be legible at a glance. */}
          <span className={cn("block truncate", META, used && "text-out/80")}>{detail}</span>
        </span>
      </span>

      <span className="flex shrink-0 items-center justify-end gap-3">
        {/* Fixed 28px from the design, and that width is the point: it holds the
            radios in a straight column whether a team has 7, 27 or 107 points.
            `text-right` so the digits sit flush against the radio rather than
            drifting off it, and `tabular-nums` so a live score does not jitter the
            column as it ticks over.

            Dark on a card that is yours, muted on one that is not — the single
            difference between the designed Selected and Locked states. It keys on
            the CARD, not the row, so a matchup you picked shows both scores at
            full strength. */}
        {score !== null ? (
          <span
            data-score
            className={cn(
              "w-7 text-right text-[16px] font-semibold leading-[1.35] tracking-[-0.16px] tabular-nums",
              cardSelected ? "text-shell-ink" : "text-shell-mute",
            )}
          >
            {score}
          </span>
        ) : null}

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
      </span>
    </label>
  );
}

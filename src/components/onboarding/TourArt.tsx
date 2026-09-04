"use client";

import { LockIcon } from "@/components/icons";
import { Pill } from "@/components/ui/Badge";
import { TeamLogo } from "@/components/ui/TeamLogo";
import type { TourStep } from "./tour-steps";

/**
 * The five illustrations that sit in the tour's art frame.
 *
 * Every one is a static replica of a real surface — the bottom tab bar, a
 * matchup card, the week strip, the pick hero, three standings rows — drawn
 * from the same tokens the real component uses rather than screenshotted. Two
 * consequences worth knowing:
 *
 *   1. They are DECORATIVE. The frame that holds them carries `aria-hidden`, so
 *      nothing in here is announced; the step's title and body are what a
 *      screen reader gets, and they are written to stand alone. Nothing in here
 *      may become focusable or interactive — a tappable-looking team card that
 *      does nothing is worse than a picture of one.
 *   2. They are NOT the real components. Importing `WeekStrip` or `TeamGrid`
 *      here would drag their data requirements, their scroll behaviour and
 *      their reveal animations into a 180px box, and would make the tour break
 *      whenever those screens changed shape. A replica that drifts is the
 *      accepted cost; a tour that cannot render is not.
 *
 * The teams are the design's and are hardcoded: this is a picture, not a view
 * of anyone's league. A real fixture would make the art depend on a schedule
 * being loaded, which is the one thing a first-run tour cannot assume.
 */

/** Shared with the real bar: the tour is claiming to show you that surface. */
const TAB_LABELS = ["Picks", "Standings", "Account"] as const;

export function TourArt({ step }: { step: TourStep }) {
  switch (step.art) {
    case "tabs":
      return <TabsArt active={step.tab ?? 0} />;
    case "card":
      return <CardArt />;
    case "strip":
      return <StripArt />;
    case "lock":
      return <LockArt />;
    case "board":
      return <BoardArt />;
  }
}

/**
 * The bottom tab bar, with one tab lit.
 *
 * `min-[375px]:min-w-[100px]` with the narrower padding below it is not a
 * simplification of the real bar — it is exactly what `BottomTabBar` does, and
 * for the same arithmetic: three 100px tabs plus the pill's own padding want
 * 324px, which does not fit the art frame on a 320px phone. Letting the frame
 * clip instead would draw a bar that the app never actually draws.
 */
function TabsArt({ active }: { active: 0 | 1 | 2 }) {
  return (
    <div className="flex shrink-0 items-center rounded-card border border-shell-line/50 bg-white px-3 py-2 shadow-[0_6px_6px_rgba(0,0,0,0.08)]">
      {TAB_LABELS.map((label, i) => (
        <span
          key={label}
          className={
            "flex h-10 items-center justify-center whitespace-nowrap rounded-control px-3 text-base font-semibold leading-[1.2] min-[375px]:min-w-[100px] min-[375px]:px-4 " +
            (i === active ? "bg-fill-soft text-black" : "text-shell-mute")
          }
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * A matchup card with the home team selected — the `WeekSchedule` layout.
 *
 * 281px is the design's, and it is a fixed width rather than a fill: the frame
 * is 180px tall at every viewport, so an art piece that grew with the sheet
 * would change shape between a phone and a desktop while the copy beside it
 * did not.
 */
function CardArt() {
  return (
    <div className="w-[281px] max-w-full">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="text-xs font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute">
          Sun, Sep 13
        </span>
        <span className="text-xs font-medium leading-[1.4] tracking-[-0.12px] tabular-nums text-shell-mute">
          1:00 PM EDT
        </span>
      </div>
      <div className="flex flex-col rounded-control border border-accent bg-white p-1">
        <MatchupRow teamId="buf" name="Bills" side="Home" selected />
        <MatchupRow teamId="nyj" name="Jets" side="Away" />
      </div>
    </div>
  );
}

function MatchupRow({
  teamId,
  name,
  side,
  selected = false,
}: {
  teamId: "buf" | "nyj";
  name: string;
  side: "Home" | "Away";
  selected?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-control p-2 " +
        (selected ? "bg-accent-faded" : "")
      }
    >
      <span className="flex min-w-0 items-center gap-3">
        <TeamLogo teamId={teamId} size={36} />
        <span className="min-w-0">
          <span className="block text-[18px] font-semibold leading-[1.2] tracking-[-0.18px] text-shell-ink">
            {name}
          </span>
          <span className="block text-xs font-medium leading-[1.4] tracking-[-0.12px] text-shell-mute">
            {side}
          </span>
        </span>
      </span>
      {/* A drawn radio, not an <input>: this whole frame is aria-hidden and
          non-interactive, and a real input here would be focusable. */}
      <span
        className={
          "grid h-4 w-4 shrink-0 place-items-center rounded-pill border bg-white " +
          (selected ? "border-accent" : "border-shell-ink")
        }
      >
        {selected ? <span className="h-2.5 w-2.5 rounded-pill bg-accent" /> : null}
      </span>
    </div>
  );
}

/**
 * Five week chips: a week survived, a week lost, a week picked and undecided,
 * the live week, and one still to come.
 *
 * The two washes are the week strip's own settled fills, spelled as
 * token/opacity pairs rather than the design's raw rgba — `result-win-fill` at
 * 60% and `result-loss-fill-deep` at 40% are the same two colours `WeekStrip`
 * paints, so a change to the palette reaches this picture too.
 *
 * The selected chip steps 2px -> 6px on the radius, which is how selection
 * reads in the real strip; it is not an arbitrary rounder corner.
 */
function StripArt() {
  return (
    <div className="flex items-center gap-0.5">
      <SettledChip teamId="buf" numeral="01" fill="bg-result-win-fill/60" ink="text-result-win" />
      <SettledChip
        teamId="dal"
        numeral="02"
        fill="bg-result-loss-fill-deep/40"
        ink="text-result-loss"
      />
      <SettledChip teamId="kc" numeral="03" fill="bg-fill-soft" ink="text-shell-mute" />
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-md bg-accent">
        <span className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums text-white">
          04
        </span>
      </span>
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-sm bg-fill-soft">
        <span className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums text-shell-ink">
          05
        </span>
      </span>
    </div>
  );
}

function SettledChip({
  teamId,
  numeral,
  fill,
  ink,
}: {
  teamId: "buf" | "dal" | "kc";
  numeral: string;
  fill: string;
  ink: string;
}) {
  return (
    <span
      className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-sm ${fill}`}
    >
      <TeamLogo teamId={teamId} size={30} />
      <span
        className={`absolute right-1 top-0.5 text-[10px] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums ${ink}`}
      >
        {numeral}
      </span>
    </span>
  );
}

/** The pick hero's crest row, with the lock countdown and the privacy line. */
function LockArt() {
  return (
    <div className="flex w-[281px] max-w-full items-center gap-4">
      <TeamLogo teamId="buf" size={72} />
      <div className="min-w-0">
        <span className="block text-xs font-semibold uppercase leading-none text-shell-mute">
          Buffalo
        </span>
        <span className="mt-0.5 block text-[34px] font-semibold leading-none tracking-[-0.04em] text-shell-ink">
          Bills
        </span>
        <span className="mt-2.5 block text-xs font-medium leading-[1.4] text-shell-ink">
          Locks in 2d 4h
        </span>
        <span className="block text-xs font-medium leading-[1.4] text-shell-mute">
          Only you can see this pick
        </span>
      </div>
    </div>
  );
}

/**
 * Three standings rows: two picks still hidden, one revealed by kickoff.
 *
 * The revealed row is the whole point of the step — it shows that a pick
 * becomes visible when its game starts, not that it stays secret forever.
 */
function BoardArt() {
  return (
    <div className="flex w-[281px] max-w-full flex-col gap-2.5">
      <BoardRow initials="AN" name="You" />
      <BoardRow initials="RM" name="Rae M." />
      <BoardRow initials="DK" name="Dev K." revealed />
    </div>
  );
}

function BoardRow({
  initials,
  name,
  revealed = false,
}: {
  initials: string;
  name: string;
  revealed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-control border border-shell-line bg-white px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-fill-soft text-[11px] font-semibold leading-none text-shell-mute">
          {initials}
        </span>
        <span className="text-[15px] font-semibold leading-[1.2] text-shell-ink">{name}</span>
      </span>
      {revealed ? (
        <span className="flex items-center gap-2">
          <TeamLogo teamId="phi" size={24} />
          <span className="text-xs font-medium leading-[1.4] text-shell-mute">Kicked off</span>
        </span>
      ) : (
        /* `Pill`'s `hidden` variant is already the design's two colours exactly,
           so this reuses the component rather than retyping them. The size
           override resolves the right way round: `text-[13px]` is an arbitrary
           LENGTH, which tailwind-merge files as a font size and so replaces
           `Pill`'s `text-sm`, while the variant's ink is a colour and lands in a
           different group untouched. Getting that backwards is what silently
           deletes a custom text token — `Label` documents the trap. */
        <Pill variant="hidden" icon={<LockIcon />} className="text-[13px] leading-[1.2]">
          Hidden
        </Pill>
      )}
    </div>
  );
}

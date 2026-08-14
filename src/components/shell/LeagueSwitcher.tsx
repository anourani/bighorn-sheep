"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "@/components/icons";
import { Label } from "@/components/ui/Label";
import { selectLeague } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import type { LeagueOption } from "@/lib/league/load";

/** Stable codes in, human copy out. Never render a raw error from the server. */
const ERROR_COPY: Record<string, string> = {
  not_a_member: "You're no longer in that league.",
  not_authenticated: "Please sign in again.",
};
const ERROR_FALLBACK = "Couldn't switch leagues. Try again.";

/**
 * The right-hand column's width policy, shared by both branches.
 *
 * `shrink-0` keeps the league from being squeezed by the app name — but on its
 * own it also lets one long league name push the header past the viewport (a
 * 55-character name measured 526px of scrollWidth at 390px). `max-w-[45%]`
 * caps it against the header's content box and hands the overflow to the
 * name's own `truncate`; the app name on the left takes the other half via
 * `min-w-0` + `truncate`. Neither block can starve the other.
 */
const COLUMN = "min-w-0 max-w-[45%] shrink-0";

/**
 * The header's right-hand block: a `LEAGUE` eyebrow over the active league's
 * name and a chevron — and, when the viewer is in more than one, the control
 * that switches between them.
 *
 * The mechanism is a transparent native `<select>` laid OVER that markup, the
 * same disguise `WeekPicker` wears and for a sharper reason: a select sizes
 * itself to its *widest* option, so with `appearance-none` one long league name
 * would set the control's width permanently and shove the name and chevron away
 * from the right edge the design pins them to. Overlaying keeps the expanded
 * menu the platform's own — and the platform marks the selected option for free
 * (a checkmark on macOS/iOS, a radio dot on Android, announced as "selected"),
 * which is better semantics than a hand-rolled `aria-checked`.
 *
 * The alternative was a popover, and there is no primitive here to build one on
 * (the deps are `clsx` and `tailwind-merge`): it would mean owning
 * `aria-expanded`, roving focus, Escape, outside-click and viewport clamping at
 * 390px. It would also hit a trap specific to this header — `backdrop-blur-md`
 * makes the header a containing block for `position: fixed` descendants, so a
 * "fixed" panel would position against the header rather than the viewport.
 */
export function LeagueSwitcher({
  leagues,
  activeId,
}: {
  /** Every league the viewer belongs to, earliest-joined first. */
  leagues: LeagueOption[];
  activeId: string;
}) {
  const router = useRouter();
  const selectId = useId();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /*
    NOT useState. This component lives in the layout, and Next preserves layouts
    across sibling-route navigation — so switching leagues on the account page
    and then tabbing to My Picks would leave local state showing the old league
    beside a server-rendered body showing the new one. `useOptimistic` re-syncs
    to the prop whenever it changes, and reverts by itself when the transition
    finishes without the prop moving (i.e. when the switch failed).
  */
  const [optimisticId, setOptimisticId] = useOptimistic(activeId);

  const active = leagues.find((l) => l.id === optimisticId) ?? leagues[0];
  if (!active) return null;

  function switchTo(id: string) {
    startTransition(async () => {
      setOptimisticId(id);
      setError(null);
      try {
        const res = await selectLeague(id);
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? ERROR_FALLBACK);
          return;
        }
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError(ERROR_FALLBACK);
      }
    });
  }

  /*
    One league is not a choice. A disclosure that discloses a single
    already-selected item is a dead end, and on iOS a one-option select still
    opens a full-screen wheel to change nothing. Accepted trade: the affordance
    isn't discoverable until you join a second league, at which point the header
    re-renders with it.
  */
  if (leagues.length === 1) {
    return (
      <div className={`${COLUMN} flex flex-col items-start gap-1`}>
        <Label>League</Label>
        <span className="max-w-full truncate text-base font-semibold leading-[1.2] text-shell-ink">
          {active.name}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className={`relative flex flex-col items-start gap-1 ${COLUMN}`}>
        {/*
          First in the DOM so the trigger can be its `peer` — Tailwind's peer-*
          compiles to a sibling combinator and only reaches forwards. An
          opacity-0 control still takes focus and still opens on tap, but the
          global :focus-visible ring paints on it invisibly, so the ring is
          mirrored onto the visible name below.

          -inset-y-1, NOT WeekPicker's -inset-y-2. This column measures 12 + 4 +
          19.2 = 35.2px, so 4px of bleed top and bottom gives 43.2px — the tap
          target, while staying inside the header's own 16/12 padding. -inset-y-2
          would spill past the header's bottom border and lay an invisible
          interactive surface over the top of the status bar, silently swallowing
          clicks there.

          inset-x-0 pins the width to the column, so the select's intrinsic
          "as wide as the longest option" sizing never reaches layout.
          text-base keeps iOS Safari from zooming the viewport on focus.
        */}
        <select
          id={selectId}
          value={optimisticId}
          onChange={(e) => switchTo(e.target.value)}
          className="peer absolute inset-x-0 -inset-y-1 z-10 cursor-pointer text-base opacity-0"
        >
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <Label htmlFor={selectId}>League</Label>

        <span className="flex max-w-full items-center gap-1 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand-strong/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white">
          <span className="truncate text-base font-semibold leading-[1.2] text-shell-ink">
            {active.name}
          </span>
          {/* The icon set is drawn on a 24-unit grid, so at 16×16 it scales by
              16/24 — 2.4 units is what renders as a true 1.6px stroke. (That 2.4
              also gives a true 2px at WeekPicker's 20×20 is a coincidence of
              those two sizes, not a universal constant.) */}
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-shell-ink" strokeWidth={2.4} />
        </span>
      </div>

      {/*
        There is no room for an error line inside 68px of header, and growing the
        header would shove the whole page down. Absolutely positioned against the
        header (which is a containing block by virtue of being sticky), so it can
        never change its height.
      */}
      {error ? (
        <p
          role="alert"
          className="absolute inset-x-0 top-full bg-out-wash px-4 py-1 text-xs font-medium text-out"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

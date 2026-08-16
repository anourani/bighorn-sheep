"use client";

import { Label } from "@/components/ui/Label";
import { GearIcon } from "@/components/icons";
import { survivorCounts } from "@/lib/league/view";
import type { Group, Member } from "@/lib/league/types";
import type { SeasonPhase } from "@/lib/game/season";

/**
 * One tile: the mockup's grey label / dark value pair on a soft-grey card.
 *
 * `justify-end` rather than the obvious `justify-start`: the four tiles are grid
 * items of equal height, and when one value wraps to two lines the other three
 * must keep their label/value pair pinned to the bottom edge rather than
 * floating in the middle of the taller box.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-end gap-1.5 rounded bg-fill-soft px-2 py-4 lg:pb-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-lg font-semibold leading-[1.2] text-shell-ink">{children}</span>;
}

/**
 * The standings page's league summary: name, the week in play, how many are
 * left, and the rules link — four tiles across on desktop, 2×2 on a phone.
 *
 * Phase-aware in two of the four fields. Before Week 1 there is no week number
 * to name and nobody can be eliminated, so both read the pre-season form until
 * the season starts.
 *
 * Your own pick is deliberately NOT one of these fields, though it was: the
 * mockup gives that slot to the week, and the pick is still a tab away on My
 * Picks and in the row the standings table highlights for you.
 *
 * There is no section heading here any more. The mockup opens the page on the
 * tiles themselves, which is why the admin gear — previously the heading's right
 * slot, and still the only way into `AdminSettingsModal` anywhere in the app —
 * now sits on its own row above them.
 */
export function LeagueDetails({
  group,
  members,
  currentWeek,
  phase,
  isAdmin,
  onOpenRules,
  onOpenSettings,
}: {
  group: Group;
  members: Member[];
  currentWeek: number;
  phase: SeasonPhase;
  isAdmin: boolean;
  onOpenRules: () => void;
  onOpenSettings: () => void;
}) {
  const isPreseason = phase === "preseason";
  const { alive, total } = survivorCounts(members);

  return (
    <section>
      {/* Admin-only, so a player sees the tiles flush against the header exactly
          as the mockup draws them. */}
      {isAdmin ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Group settings"
            className="grid h-9 w-9 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink"
          >
            <GearIcon className="h-5 w-5" />
          </button>
        </div>
      ) : null}

      {/* Four across from `lg`, not `sm`: inside the 1000px `max-w-shell` that
          lands each tile on the mockup's 236px, and `lg` is the one breakpoint
          the rest of this page already turns on (the table and the survivor
          strip both un-bleed there). At `sm` the four would be ~146px and
          "Bighorn Survivors" would wrap in every league with a real name. */}
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4 lg:gap-2">
        <Field label="League">
          <Value>{group.name}</Value>
        </Field>

        {/* Derived from `currentWeek`, never a literal — the number advances on
            its own as the season does, here and in the status report below. */}
        <Field label="Current week">
          <Value>{isPreseason ? "Pre-season" : `Week ${currentWeek}`}</Value>
        </Field>

        {isPreseason ? (
          <Field label="Players">
            <Value>{members.length} in</Value>
          </Field>
        ) : (
          <Field label="Survivors">
            <Value>
              {alive} out of {total}
            </Value>
          </Field>
        )}

        <Field label="Rules">
          {/* A button, not an anchor: it opens a dialog, it doesn't navigate.
              `self-start` keeps the hit area to the words themselves — a
              block-level button in a flex column would claim the tile's full
              width. */}
          <button
            type="button"
            onClick={onOpenRules}
            className="self-start rounded-sm text-lg font-medium leading-[1.2] text-link underline underline-offset-2"
          >
            League Rules
          </button>
        </Field>
      </div>
    </section>
  );
}

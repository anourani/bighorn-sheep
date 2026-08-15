"use client";

import { Label } from "@/components/ui/Label";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { GearIcon } from "@/components/icons";
import { survivorCounts } from "@/lib/league/view";
import type { Group, Member } from "@/lib/league/types";
import type { SeasonPhase } from "@/lib/game/season";

/** The mockup's grey label / dark value pair. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
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
 * left, and the rules link.
 *
 * Phase-aware in two of the four fields. Before Week 1 there is no week number
 * to name and nobody can be eliminated, so both read the pre-season form until
 * the season starts.
 *
 * Your own pick is deliberately NOT one of these fields, though it was: the
 * mockup gives that slot to the week, and the pick is still a tab away on My
 * Picks and in the row the standings table highlights for you.
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
      <SectionHeader
        title="League"
        right={
          isAdmin ? (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Group settings"
              className="grid h-9 w-9 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink"
            >
              <GearIcon className="h-5 w-5" />
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-x-6 gap-y-4 border-b border-line py-4">
        <Field label="League name">
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

        <Field label="League rules">
          {/* A button, not an anchor: it opens a dialog, it doesn't navigate. */}
          <button
            type="button"
            onClick={onOpenRules}
            className="self-start rounded-sm text-base font-medium leading-none text-link underline underline-offset-2"
          >
            League Rules
          </button>
        </Field>
      </div>
    </section>
  );
}

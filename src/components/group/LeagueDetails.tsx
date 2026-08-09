"use client";

import { SectionHeader } from "@/components/ui/SectionHeader";
import { GearIcon } from "@/components/icons";
import { pickForWeek, viewerPicksByWeek, type PendingPicks } from "@/lib/league/picks";
import { survivorCounts } from "@/lib/league/view";
import { PRE_WEEK, REGULAR_WEEK, weekLabel, type WeekRef } from "@/lib/nfl/calendar";
import { getTeam } from "@/lib/nfl/teams";
import type { PracticeState } from "@/lib/league/practice";
import type { Group, Member } from "@/lib/league/types";
import type { SeasonPhase } from "@/lib/game/season";

/** No optimistic overlay on this screen — the picks screen owns that. */
const NO_PENDING: PendingPicks = new Map();

/** The mockup's grey label / dark value pair. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase leading-none text-[#757575]">{label}</span>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-lg font-semibold leading-[1.2] text-[#1E1E1E]">{children}</span>;
}

/**
 * The standings page's league summary: name, your pick for the week in play, how
 * many are left, and the rules link.
 *
 * Phase-aware in two of the four fields. Before Week 1 nobody can be eliminated,
 * so "survivors" is meaningless and the live pick is the practice one; in season
 * both flip to the real thing.
 */
export function LeagueDetails({
  group,
  members,
  viewerId,
  currentWeek,
  phase,
  practice,
  isAdmin,
  onOpenRules,
  onOpenSettings,
}: {
  group: Group;
  members: Member[];
  viewerId: string;
  currentWeek: number;
  phase: SeasonPhase;
  practice: PracticeState | null;
  isAdmin: boolean;
  onOpenRules: () => void;
  onOpenSettings: () => void;
}) {
  const isPreseason = phase === "preseason";
  const me = members.find((m) => m.id === viewerId);
  const practiceMe = practice?.members[viewerId];

  // The week this field is answering for. A bare number would merge preseason
  // week 1 with opening Sunday — they are different picks in different games.
  const weekInPlay: WeekRef =
    isPreseason && practice ? PRE_WEEK(practice.currentWeek) : REGULAR_WEEK(currentWeek);

  // Indexed by week, so a `currentPick` left over from another week can never be
  // painted under this week's label.
  const picks = viewerPicksByWeek({
    history: me?.history,
    currentPick: me?.currentPick ?? null,
    practicePicks: practiceMe?.picks,
  });
  const teamId = pickForWeek(weekInPlay, picks, NO_PENDING);
  const pickValue = (teamId && getTeam(teamId)?.name) || "No Team Selected";

  const pickLabel = isPreseason
    ? practice
      ? `Your ${weekLabel(weekInPlay, { maxPreWeek: practice.maxPreWeek })} pick`
      : "Your practice pick"
    : `Your W${currentWeek} pick`;

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

        <Field label={pickLabel}>
          <Value>{pickValue}</Value>
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

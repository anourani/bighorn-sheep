"use client";

import { Label } from "@/components/ui/Label";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { nextTabIndex, panelId, tabId } from "@/components/ui/tabs";
import { H5 } from "@/lib/type-scale";
import type { EntryNo } from "@/lib/league/types";

/** One card's worth of state: which entry, and what it has picked this week. */
export interface EntryTab {
  entryNo: EntryNo;
  /** The team this entry has picked for the week on screen, or null. */
  teamId: TeamId | null;
}

/**
 * The entry switcher — two cards saying which of your entries you are picking
 * for, and what each has already taken this week.
 *
 * Figma `4234:67832` (desktop) / `4234:68190` (mobile); the card atom is 361px
 * wide over two `flex-1` children at a 4px gap, 60px tall, `rounded-control`.
 *
 * WHY THIS IS A CARD AND NOT A SEGMENTED CONTROL. The cost of getting it wrong
 * is a team spent for the season on the wrong entry, so the control does not
 * merely say WHICH entry is selected — it shows what each one currently holds.
 * A player who can see "Entry 1 — Ravens / Entry 2 — No Pick" cannot tap the
 * wrong one without noticing, which a two-word toggle cannot promise. That is
 * also why there is no attention dot on an unpicked entry: "No Pick" is already
 * the strongest signal the card can carry, and a dot beside those words would
 * be decoration restating them.
 *
 * ONE COMPONENT, TWO PLACEMENTS. The picks page renders this in flow at the top
 * of the column; `PickStickyBar` renders the same thing, at the same size, once
 * the pick module has scrolled away. The design draws identical 60px cards in
 * both, so there is no compact variant and no `size` prop — a second geometry
 * is how the two would drift.
 *
 * A REAL TABLIST, with roving tabindex through `nextTabIndex` (wrapping, per
 * WAI-ARIA) rather than `Tabs.tsx`. That component is the right ARIA and the
 * wrong look — a text row of pills — and bending it to draw a 60px card with a
 * logo in it would change its three other callers. The keyboard contract is
 * shared instead of reimplemented, which is the part worth not duplicating.
 *
 * The panel this controls is the pick module and the grid below it, which is
 * `MyPicksClient`'s subtree rather than a child of this component — hence
 * `aria-controls` pointing at an id the caller owns.
 */
export function EntryTabs({
  tabs,
  value,
  onChange,
  panelKey,
  className,
}: {
  tabs: EntryTab[];
  value: EntryNo;
  onChange: (entryNo: EntryNo) => void;
  /**
   * Identifies the region these tabs control, so `aria-controls` resolves. The
   * two placements pass different keys — the same tablist twice in one document
   * would otherwise emit duplicate ids.
   */
  panelKey: string;
  className?: string;
}) {
  // Below two entries there is nothing to switch between, and a one-tab tablist
  // is noise in the accessibility tree as well as on screen. This is the branch
  // every single-entry player takes, i.e. all of them until someone adds one.
  if (tabs.length < 2) return null;

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.entryNo === value),
  );

  return (
    <div
      role="tablist"
      aria-label="Your entries"
      className={cn("flex gap-1", className)}
      onKeyDown={(e) => {
        const next = nextTabIndex(activeIndex, e.key, tabs.length);
        if (next === null) return;
        // Arrow keys scroll the page by default, and this row sits directly
        // above a grid — so an un-prevented ArrowRight both moves the tab and
        // jumps the viewport.
        e.preventDefault();
        onChange(tabs[next]!.entryNo);
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.entryNo === value;
        const team = tab.teamId ? getTeam(tab.teamId) : undefined;
        return (
          <button
            key={tab.entryNo}
            type="button"
            role="tab"
            id={tabId(panelKey, String(tab.entryNo))}
            aria-controls={panelId(panelKey, String(tab.entryNo))}
            aria-selected={selected}
            // Roving tabindex: one stop for the whole row, arrows move within
            // it. Without this a two-entry player tabs through both cards to
            // reach the grid, and a screen reader announces the row twice.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.entryNo)}
            className={cn(
              "flex h-[60px] min-w-[100px] flex-1 flex-col items-center gap-0.5 rounded-control border-2 px-2 pt-1.5",
              // Unselected fill is `fill-soft` #F3F3F3 where the frame draws
              // #F2F2F2 — one unit, and the token is worth more than the match.
              selected
                ? "border-accent bg-accent-faded"
                : "border-shell-line bg-fill-soft",
            )}
          >
            <Label className={selected ? "text-shell-ink" : undefined}>Entry {tab.entryNo}</Label>
            {/* Fixed 28px, so the row does not change height between a card
                showing a logo and one showing "No Pick" — the same
                don't-move-under-the-finger rule the tour's art frame follows. */}
            <span
              className={cn(
                "flex h-7 items-center gap-1",
                H5,
                selected ? "text-shell-ink" : "text-shell-mute",
              )}
            >
              {team ? (
                <>
                  <TeamLogo teamId={team.id} size={28} />
                  {/* The nickname alone, not "LAC Chargers": at 100px minimum
                      width beside a 28px logo there is room for one word, and
                      the logo already says which city. */}
                  <span className="truncate">{team.name}</span>
                </>
              ) : (
                "No Pick"
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

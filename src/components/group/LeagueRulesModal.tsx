"use client";

import { Modal } from "@/components/ui/Modal";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { LocalTime } from "@/components/ui/LocalTime";
import { InfoIcon, LockIcon } from "@/components/icons";
import { joinClosesAt } from "@/lib/game/season";
import type { Group, Member } from "@/lib/league/types";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
      <Label>{label}</Label>
      <div className="mt-1 text-sm font-medium text-ink">{children}</div>
    </div>
  );
}

/**
 * The league's rules, in full, for everyone — as opposed to `AdminSettingsDrawer`,
 * which is the admin's control panel behind the gear.
 *
 * THE SEVEN RULES ARE FIXED COPY, and that is a decision rather than an
 * oversight. They were written by the commissioner and they assert this
 * league's settings outright: single elimination, and a tie counting as a loss.
 * The previous version generated those two clauses from `group.rules` so the
 * prose could never contradict the tiles; this one cannot, and if an admin ever
 * switches Tie Rule to "Push" or elimination to two-time in the settings drawer,
 * rule 1 will disagree with the tile a few inches below it. Accepted knowingly —
 * the wording is the league's own and reads worse when assembled from fragments.
 * If those settings do change, this copy is what has to change with them.
 *
 * The two DATES are the opposite call: both are derived, and from the same two
 * timestamps the tiles print, so the paragraph and the grid cannot drift apart
 * or go stale next season.
 *
 * Order is rules → prose → tiles. The tiles used to sit above the rules with a
 * commissioner card above them again; the card is gone (its one fact is a
 * sentence now) and the settings read as a footnote to the rules rather than as
 * the thing you open this dialog for.
 */
export function LeagueRulesModal({
  open,
  onClose,
  group,
  members,
}: {
  open: boolean;
  onClose: () => void;
  group: Group;
  members: Member[];
}) {
  // The NAME is still derived, unlike the rules copy: it is data about who holds
  // the role, not a claim about how the league is played. `find` takes the first
  // admin, so a league with two would name one of them.
  const commissioner = members.find((m) => m.role === "admin");
  const locked = Boolean(group.settingsLockedAt);

  return (
    <Modal open={open} onClose={onClose} eyebrow="League" title="League Rules" description={group.name}>
      <div className="space-y-6">
        {/* The game itself */}
        <section className="space-y-2">
          <SectionHeading>The Rules</SectionHeading>
          {/* An ordered list, so the numbering is the browser's rather than seven
              hand-typed digits that renumber wrongly the moment a rule is added.
              `list-decimal` is not optional: Tailwind's preflight sets
              `list-style: none` on every ol and ul, so without it this renders as
              seven unnumbered paragraphs — which looks like a copy bug rather
              than a CSS one. The markers take the ink colour and the body stays
              soft, so the numbers read as structure. */}
          <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-ink-soft marker:font-medium marker:text-ink">
            <li>
              Pick one NFL team each week. If the team you pick wins, you advance. If the team you
              pick loses or the game ends in a tie, you&apos;re out.
            </li>
            <li>
              You can only pick each team once per season. Your picks are your own. They
              don&apos;t affect what anyone else is allowed to pick.
            </li>
            <li>
              A pick locks the instant that team&apos;s game kicks off, not at one shared deadline.
              Change your pick as often as you want before that.
            </li>
            <li>
              If no pick is made before the last kickoff of the week, whatever day it lands on,
              it&apos;s an automatic loss.
            </li>
            <li>
              Picks stay invisible to everyone else until that player&apos;s team kicks off.
            </li>
            <li>Last player standing wins the season.</li>
            <li>
              If more than one player survives throughout the entire season, the commissioner
              decides how it ends (tiebreaker, co-champs).
            </li>
          </ol>
        </section>

        {/* Who runs it, and when the season runs */}
        <section className="space-y-2 text-sm leading-relaxed text-ink-soft">
          <p>
            The League Commissioner{commissioner ? <> ({commissioner.name})</> : null} settles every
            dispute. Reach out to them if you have any questions, comments, or concerns.
          </p>
          <p>
            {/* Two readings of two different timestamps, and the distinction is the
                whole point: `entryClosesAt` is the FIRST kickoff of Week 1 (the
                season starts, the rules freeze, practice ends) and `joinClosesAt`
                is the LAST (joining stops). They were one column until migration
                0018 — see src/lib/game/season.ts. No year is printed: `time.ts`
                has no year-bearing formatter and the Season tile below already
                carries it. */}
            <span className="font-medium text-ink">Season:</span> The season starts{" "}
            <LocalTime iso={group.entryClosesAt} mode="weekdayordinal" />. New entries can&apos;t be
            added after the last kickoff of Week 1 (
            <LocalTime iso={joinClosesAt(group)} mode="full" />
            ).
          </p>
        </section>

        {/* This league's settings */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionHeading>This league</SectionHeading>
            {locked ? (
              <Pill variant="hidden" icon={<LockIcon />}>
                Locked
              </Pill>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Elimination">
              {group.rules.eliminationType === "single" ? "Single (1 loss)" : "Two-time (2 losses)"}
            </Tile>
            <Tile label="Tie rule">{group.rules.tieRule === "push" ? "Push (survive)" : "Loss"}</Tile>
            <Tile label="Season">
              {group.season}-{group.season + 1}
            </Tile>
            {/* The JOIN deadline, not `entryClosesAt` — this tile is labelled
                "Entry closes" and that is the moment `join_by_invite` starts
                refusing codes. Reading the season start here instead would put
                two different deadlines on one screen, since the paragraph above
                prints this same value.

                "full", not "dayclock": a deadline rendered as "Fri 12:20 AM"
                doesn't say WHICH Friday. */}
            <Tile label="Entry closes">
              <LocalTime iso={joinClosesAt(group)} mode="full" />
            </Tile>
          </div>
          {locked ? (
            <p className="flex items-start gap-1.5 text-xs text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Rules locked when Week 1 picks began — they can&apos;t change mid-season.
            </p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}

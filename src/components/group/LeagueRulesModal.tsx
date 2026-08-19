"use client";

import { Modal } from "@/components/ui/Modal";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { LocalTime } from "@/components/ui/LocalTime";
import { InfoIcon, LockIcon } from "@/components/icons";
import { strikeAllowance, type Group, type Member } from "@/lib/league/types";

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
 * The elimination and tie sentences are generated from `group.rules` so the copy
 * states THIS league's setting rather than listing both options and leaving the
 * reader to work out which one they're playing.
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
  const commissioner = members.find((m) => m.role === "admin");
  const locked = Boolean(group.settingsLockedAt);
  const allowance = strikeAllowance(group.rules.eliminationType);

  const lossRule =
    group.rules.eliminationType === "single"
      ? "One loss and you're out."
      : "Two losses and you're out — the first is a strike.";
  const tieRule =
    group.rules.tieRule === "push"
      ? "A tie is a push: you neither win nor lose the week, and you survive it."
      : "A tie counts exactly the same as a loss.";

  return (
    <Modal open={open} onClose={onClose} eyebrow="League" title="League Rules" description={group.name}>
      <div className="space-y-6">
        {/* Who runs it */}
        <section className="space-y-2">
          <SectionHeading>Commissioner</SectionHeading>
          {commissioner ? (
            <div className="flex items-center gap-3 rounded-control border border-line bg-[#FAFAFB] p-3">
              <Avatar
                firstName={commissioner.firstName}
                lastName={commissioner.lastName}
                favoriteAnimal={commissioner.favoriteAnimal}
                size={40}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{commissioner.name}</div>
                <p className="text-xs text-ink-mute">
                  Runs this league — settles disputes and any result the feed gets wrong.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">This league has no commissioner set.</p>
          )}
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
            {/* "full", not "dayclock": a deadline rendered as "Fri 12:20 AM"
                doesn't say WHICH Friday. */}
            <Tile label="Entry closes">
              <LocalTime iso={group.entryClosesAt} mode="full" />
            </Tile>
          </div>
          {locked ? (
            <p className="flex items-start gap-1.5 text-xs text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Rules locked when Week 1 picks began — they can&apos;t change mid-season.
            </p>
          ) : null}
        </section>

        {/* The game itself */}
        <section className="space-y-2">
          <SectionHeading>How the game works</SectionHeading>
          <ul className="space-y-2.5 text-sm leading-relaxed text-ink-soft">
            <li>
              <span className="font-medium text-ink">Pick one team a week.</span> If they win, you
              survive to the next week. {lossRule}
            </li>
            <li>
              <span className="font-medium text-ink">A team can only be used once all season.</span>{" "}
              Spend the good ones carefully — there are 32 teams and 18 weeks.
            </li>
            <li>
              <span className="font-medium text-ink">Picks lock at kickoff — their kickoff.</span> A
              team becomes unpickable the moment its own game starts, not at one weekly deadline. A
              Thursday team locks Thursday.
            </li>
            <li>
              <span className="font-medium text-ink">Miss a week and it counts as a loss.</span> Once
              the week&apos;s last kickoff passes, no pick is scored the same as a wrong one.
            </li>
            <li>
              <span className="font-medium text-ink">Ties.</span> {tieRule}
            </li>
            <li>
              <span className="font-medium text-ink">Everyone&apos;s pick stays hidden.</span> You
              can&apos;t see what anyone else took until that team&apos;s game kicks off.
            </li>
            <li>
              <span className="font-medium text-ink">Last one standing takes the season.</span>{" "}
              Results update the moment a game goes final. If Week 18 ends with more than one
              survivor — or nobody at all — the commissioner settles it.
            </li>
          </ul>
          <p className="flex items-start gap-1.5 text-xs text-ink-mute">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {allowance === 1
              ? "You have no margin: a single wrong pick ends your season."
              : "You have two lives. The first loss costs you a strike, the second ends your season."}
          </p>
        </section>
      </div>
    </Modal>
  );
}

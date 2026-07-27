"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { CopyIcon, CheckIcon } from "@/components/icons";
import { countdown } from "@/lib/time";
import type { Group, Member } from "@/lib/league/types";

/**
 * The pre-season Standings view: there are no results yet, so instead of a grid
 * we show a countdown to kickoff, the roster of who's joined (everyone alive at
 * the gun), the league's rules, and a prominent invite CTA to recruit before
 * entry closes.
 */
export function RosterPanel({
  group,
  members,
  now,
  appUrl,
}: {
  group: Group;
  members: Member[];
  now: Date;
  appUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${appUrl}/login?invite=${group.inviteCode}`;
  const cd = countdown(new Date(group.entryClosesAt), now);
  const rulesLabel =
    (group.rules.eliminationType === "single" ? "Single elimination" : "Two-time — two strikes and out") +
    ` · ties ${group.rules.tieRule === "push" ? "survive" : "count as a loss"}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is shown below regardless */
    }
  }

  return (
    <div className="space-y-4">
      {/* Countdown hero */}
      <Panel className="p-card">
        <MonoLabel className="text-onsurface-mute">Season starts in</MonoLabel>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-metric leading-none text-onsurface">{cd.label}</span>
        </div>
        <p className="mt-2 text-sm text-onsurface-soft">
          Week 1 kicks off <LocalTime iso={group.entryClosesAt} mode="full" className="font-medium text-onsurface" />.
          Entry closes at kickoff — everyone in by then starts alive.
        </p>
        <MonoLabel className="mt-3 block text-onsurface-mute">{rulesLabel}</MonoLabel>
      </Panel>

      {/* Roster */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Who&apos;s in</h2>
          <MonoLabel className="text-ink-mute">
            {members.length} {members.length === 1 ? "player" : "players"}
          </MonoLabel>
        </div>
        <Panel tone="light" className="divide-y divide-line p-0">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-card py-3.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-sheen font-mono text-xs font-bold text-white ring-2 ring-white/20">
                {initials(m.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{m.name}</div>
                {m.role === "admin" ? <MonoLabel className="text-ink-mute">Commissioner</MonoLabel> : null}
              </div>
              <Pill variant="alive">In</Pill>
            </div>
          ))}
        </Panel>
      </div>

      {/* Invite CTA */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Grow the pool</h2>
        <Panel tone="light" className="p-card">
          <p className="text-sm text-ink-soft">
            Bigger pools are more fun — and last longer. Share the invite before entry closes.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-[#FAFAFB] px-3 py-2.5 font-mono text-sm text-ink">
              {group.inviteCode}
            </code>
            <Button variant="secondary" onClick={copy} aria-label="Copy invite link">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

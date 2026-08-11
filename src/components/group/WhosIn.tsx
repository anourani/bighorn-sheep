"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CopyIcon, CheckIcon } from "@/components/icons";
import { isEntryOpen } from "@/lib/game/season";
import type { Group, Member } from "@/lib/league/types";

/**
 * The league roster, at the foot of the standings page.
 *
 * Lives below the grid rather than above it: the grid answers "how is everyone
 * doing", this answers "who is everyone" — faces, names, and who to shout at.
 * Unlike the grid it renders in every phase, including before Week 1 when there
 * is nothing to score yet.
 */
export function WhosIn({ members, preseason }: { members: Member[]; preseason: boolean }) {
  return (
    <section>
      <SectionHeader
        title="Who's In"
        right={
          <Label>
            {members.length} {members.length === 1 ? "player" : "players"}
          </Label>
        }
      />
      <Panel tone="light" className="mt-4 divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-card py-3.5">
            <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{m.name}</div>
              {m.role === "admin" ? <Label>Commissioner</Label> : null}
            </div>
            {/* Before Week 1 nobody can be eliminated, so the status pill would
                only ever read "Alive" — "In" says the useful thing instead. */}
            {preseason ? (
              <Pill variant="alive">In</Pill>
            ) : m.status === "eliminated" ? (
              <Pill variant="out">Out</Pill>
            ) : (
              <Pill variant="alive">Alive</Pill>
            )}
          </div>
        ))}
      </Panel>
    </section>
  );
}

/**
 * Recruitment CTA. Hidden once entry closes at the first Week 1 kickoff — the
 * invite code still exists but `join_by_invite` will refuse it, so offering it
 * would be a dead end.
 */
export function InviteCta({ group, appUrl, now }: { group: Group; appUrl: string; now: Date }) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${appUrl}/login?invite=${group.inviteCode}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is shown alongside regardless */
    }
  }

  if (!isEntryOpen(new Date(group.entryClosesAt), now)) return null;

  return (
    <section>
      <SectionHeader title="Grow the Pool" />
      <Panel tone="light" className="mt-4 p-card">
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
    </section>
  );
}

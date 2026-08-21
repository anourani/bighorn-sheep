"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CopyIcon, CheckIcon } from "@/components/icons";
import { LocalTime } from "@/components/ui/LocalTime";
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
      <Panel tone="light" className="mt-3 divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-card py-3.5">
            <Avatar
              firstName={m.firstName}
              lastName={m.lastName}
              favoriteAnimal={m.favoriteAnimal}
              size={36}
            />
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

  async function copy() {
    // `appUrl` is inlined at build time and is deliberately unset outside
    // production, so it is often "" — building the link from it raw produced a
    // relative `/login?invite=...`, which is not a link anyone can paste.
    //
    // Resolved here rather than in render, unlike `AdminSettingsDrawer`: that
    // modal never renders on the server (`open` starts false), but this CTA
    // does, so reading `window` in the render body would break the server pass.
    // A handler only ever runs in the browser. Nothing renders the link — the
    // card shows `group.inviteCode` — so there is no hydration concern either.
    const origin = appUrl || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/login?invite=${group.inviteCode}`);
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
      <Panel tone="light" className="mt-3 p-card">
        <p className="text-sm text-ink-soft">
          Bigger pools are more fun — and last longer. Share the invite while you can.
        </p>
        {/* Name the deadline rather than alluding to it. Every member can hand
            this code out, so every member needs to know how long it is good for
            — "before entry closes" above told them there was a clock without
            telling them the time on it.

            `LocalTime` rather than a formatter called here: this card
            server-renders (Standings is `ƒ`), and a raw `toLocaleString` would
            hydrate to a different string in any timezone but the server's. It
            renders US-Eastern on the server and swaps to the reader's own zone
            after mount. `long` is the kickoff wording — "Sunday, September 10th
            at 8:20 PM EDT" — which is exactly what this deadline is. */}
        <p className="mt-2 text-sm text-ink-soft">
          Entry closes at the first Week 1 kickoff —{" "}
          <LocalTime
            iso={group.entryClosesAt}
            mode="long"
            className="font-medium text-ink"
          />
          . After that the code stops working.
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

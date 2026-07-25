"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill } from "@/components/ui/Badge";
import { CopyIcon, CheckIcon, LockIcon, InfoIcon } from "@/components/icons";
import type { Group, Member } from "@/lib/league/types";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <MonoLabel className="text-ink-mute">{children}</MonoLabel>;
}

export function AdminSettingsModal({
  open,
  onClose,
  group,
  members,
  appUrl,
}: {
  open: boolean;
  onClose: () => void;
  group: Group;
  members: Member[];
  appUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${appUrl}/login?invite=${group.inviteCode}`;
  const locked = Boolean(group.settingsLockedAt);
  const entryClosed = new Date(group.entryClosesAt).getTime() <= Date.now();

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the field is selectable as a fallback */
    }
  }

  return (
    <Modal open={open} onClose={onClose} eyebrow="Admin" title="Group settings" description={group.name}>
      <div className="space-y-6">
        {/* Rules */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionHeading>Rules</SectionHeading>
            {locked ? (
              <Pill variant="hidden" icon={<LockIcon />}>
                Locked
              </Pill>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
              <MonoLabel className="text-ink-mute">Elimination</MonoLabel>
              <div className="mt-1 text-sm font-medium text-ink">
                {group.rules.eliminationType === "single" ? "Single (1 loss)" : "Two-time (2 losses)"}
              </div>
            </div>
            <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
              <MonoLabel className="text-ink-mute">Tie rule</MonoLabel>
              <div className="mt-1 text-sm font-medium text-ink">
                {group.rules.tieRule === "push" ? "Push (survive)" : "Loss"}
              </div>
            </div>
          </div>
          {locked ? (
            <p className="flex items-start gap-1.5 text-xs text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Rules lock once Week 1 picks begin, so the league can&apos;t change mid-season.
            </p>
          ) : null}
        </section>

        {/* Invite */}
        <section className="space-y-2">
          <SectionHeading>Invite</SectionHeading>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteLink}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-control border border-line bg-white px-3 py-2 font-mono text-xs text-ink-soft"
              aria-label="Invite link"
            />
            <Button variant="secondary" size="md" onClick={copyInvite} aria-label="Copy invite link">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <MonoLabel className="text-ink-mute">Code</MonoLabel>
            <span className="font-mono text-sm font-semibold text-ink">{group.inviteCode}</span>
          </div>
          {entryClosed ? (
            <p className="flex items-start gap-1.5 text-xs text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Entry closed at the first Week 1 kickoff — new members can no longer join this season.
            </p>
          ) : null}
        </section>

        {/* Members */}
        <section className="space-y-2">
          <SectionHeading>Members · {members.length}</SectionHeading>
          <ul className="divide-y divide-line rounded-control border border-line">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{m.name}</span>
                  {m.role === "admin" ? (
                    <MonoLabel className="rounded bg-[#EEF1F6] px-1 text-[10px] text-ink-mute">Admin</MonoLabel>
                  ) : null}
                </span>
                {m.status === "eliminated" ? (
                  <Pill variant="out">Out</Pill>
                ) : (
                  <Pill variant="alive">Alive</Pill>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Data & manual override fallback */}
        <section className="space-y-2">
          <SectionHeading>Data &amp; results</SectionHeading>
          <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Live feed</span>
              <Pill variant="alive" live>
                ESPN · healthy
              </Pill>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-mute">
              Scores and eliminations update automatically. If the feed is ever down or a result is disputed, you
              can enter a game&apos;s final result by hand so the league isn&apos;t stalled.
            </p>
            <Button variant="outline" size="sm" className="mt-3" disabled>
              Enter a result manually
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

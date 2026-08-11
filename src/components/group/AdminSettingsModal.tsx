"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { CopyIcon, CheckIcon, LockIcon, InfoIcon } from "@/components/icons";
import { setMemberBuyIn } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import type { Group, Member } from "@/lib/league/types";

const BUY_IN_ERROR_COPY: Record<string, string> = {
  not_admin: "Only an admin can change that.",
  member_not_found: "That member is no longer in the league.",
  not_authenticated: "Your session expired — sign in again.",
  buy_in_update_failed: "Couldn't save that. Try again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}

/**
 * The roster, with the one thing an admin can actually change from here: who has
 * paid their buy-in.
 *
 * The toggle writes through the `set_member_buy_in` RPC, not a table update —
 * `group_members` has no UPDATE policy, so a direct write reports success and
 * changes nothing. The RPC re-checks `is_group_admin` in Postgres, which is the
 * real gate; rendering this section to an admin is only a convenience.
 */
function MembersSection({ groupId, members }: { groupId: string; members: Member[] }) {
  const router = useRouter();
  // Optimistic overlay, keyed by user id: only members whose switch has been
  // touched this session appear here, so a refresh from the server still wins
  // for everyone else.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const paidFor = (m: Member) => overrides[m.id] ?? m.buyInPaid;
  const paidCount = members.filter(paidFor).length;

  function toggle(m: Member, next: boolean) {
    if (pendingId) return;
    setError(null);
    setPendingId(m.id);
    setOverrides((o) => ({ ...o, [m.id]: next }));
    startTransition(async () => {
      try {
        const res = await setMemberBuyIn({ groupId, userId: m.id, paid: next });
        if (!res.ok) {
          setOverrides((o) => ({ ...o, [m.id]: !next }));
          setError(BUY_IN_ERROR_COPY[res.error] ?? "Couldn't save that. Try again.");
          return;
        }
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setOverrides((o) => ({ ...o, [m.id]: !next }));
        setError("Couldn't save that. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section className="space-y-2">
      <SectionHeading>
        Members · {members.length} · {paidCount} paid
      </SectionHeading>
      <ul className="divide-y divide-line rounded-control border border-line">
        {members.map((m) => {
          const paid = paidFor(m);
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                  {m.role === "admin" ? (
                    <Label className="rounded bg-[#EEF1F6] px-1 text-[10px] text-ink-mute">Admin</Label>
                  ) : null}
                </span>
                {/* Phone arrives only when RLS let this viewer read it (their own
                    row, or any member's row for a league admin). Null renders
                    nothing: absent and withheld should not look the same as a
                    placeholder would make them. */}
                {m.phone ? (
                  <span className="mt-0.5 block truncate font-mono text-xs text-ink-mute">{m.phone}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <span className={paid ? "text-xs font-medium text-ink-soft" : "text-xs text-ink-mute"}>
                  {paid ? "Paid" : "Unpaid"}
                </span>
                <Switch
                  checked={paid}
                  disabled={pendingId !== null}
                  onChange={(next) => toggle(m, next)}
                  label={`Buy-in paid — ${m.name}`}
                />
              </span>
              {m.status === "eliminated" ? <Pill variant="out">Out</Pill> : <Pill variant="alive">Alive</Pill>}
            </li>
          );
        })}
      </ul>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Buy-in is yours to track by hand — flip a switch as the money lands. Members see their own
        status on their account page and can&apos;t change it.
      </p>
      {error ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  );
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
    <Modal open={open} onClose={onClose} eyebrow="Admin" title="Group Settings" description={group.name}>
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
              <Label>Elimination</Label>
              <div className="mt-1 text-sm font-medium text-ink">
                {group.rules.eliminationType === "single" ? "Single (1 loss)" : "Two-time (2 losses)"}
              </div>
            </div>
            <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
              <Label>Tie rule</Label>
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
            <Label>Code</Label>
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
        <MembersSection groupId={group.id} members={members} />

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

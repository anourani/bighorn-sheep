"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill, StrikePips } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CreateGroupModal } from "@/components/account/CreateGroupModal";
import { JoinByCode } from "@/components/account/JoinByCode";
import { PlusIcon, LogOutIcon, DownloadIcon, ClockIcon, TrophyIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { strikeAllowance } from "@/lib/league/types";
import { timeZoneLabel } from "@/lib/time";
import type { AccountData } from "@/lib/league/load";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function TimeZoneNote() {
  const [tz, setTz] = useState<string>("");
  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const label = timeZoneLabel();
      setTz(label ? `${zone} (${label})` : zone);
    } catch {
      setTz("your device timezone");
    }
  }, []);
  return <span className="font-mono text-xs text-ink-soft">{tz || "…"}</span>;
}

export function AccountClient({ account }: { account: AccountData }) {
  const { viewer, leagues } = account;
  const [createOpen, setCreateOpen] = useState(false);
  const since = monthYear(account.memberSinceIso);

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Supabase not configured — just return to the sign-in screen.
    }
    window.location.href = "/login";
  }

  return (
    <div className="stagger mx-auto max-w-2xl space-y-4">
      {/* Profile */}
      <div>
        <Panel className="p-card">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-sheen font-mono text-xl font-bold text-white ring-2 ring-white/20">
              {initials(viewer.name)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-onsurface">{viewer.name}</h1>
              {viewer.email ? (
                <p className="truncate text-sm text-onsurface-soft">{viewer.email}</p>
              ) : null}
              {since ? (
                <div className="mt-2 flex items-center gap-2">
                  <MonoLabel className="text-onsurface-mute">Since {since}</MonoLabel>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      {/* Leagues */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Your leagues</h2>
          <MonoLabel className="text-ink-mute">
            {leagues.length} {leagues.length === 1 ? "league" : "leagues"}
          </MonoLabel>
        </div>
        <Panel tone="light" className="divide-y divide-line p-0">
          {leagues.map(({ group, role, status, strikes }) => {
            const allowance = strikeAllowance(group.rules.eliminationType);
            return (
              <Link
                key={group.id}
                href="/app/standings"
                className="flex items-center gap-3 px-card py-4 transition-colors hover:bg-[#FAFAFB]"
              >
                <div className="grid h-10 w-10 place-items-center rounded-control bg-brand-wash text-brand-strong">
                  <TrophyIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{group.name}</span>
                    {role === "admin" ? <Pill variant="brand">Admin</Pill> : null}
                  </div>
                  <MonoLabel className="text-ink-mute">
                    {group.rules.eliminationType === "single" ? "Single elim" : "Two-time"} ·{" "}
                    {group.rules.tieRule}
                  </MonoLabel>
                </div>
                <div className="flex items-center gap-2">
                  {status === "alive" ? <Pill variant="alive">Alive</Pill> : <Pill variant="out">Out</Pill>}
                  <StrikePips strikes={strikes} allowance={allowance} tone="light" />
                </div>
              </Link>
            );
          })}

          <div className="space-y-3 px-card py-4">
            {leagues.length === 0 ? (
              <p className="text-sm text-ink-mute">
                You&apos;re not in a league yet. Create one, or join with an invite code.
              </p>
            ) : null}
            <Button variant="outline" block onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create a group
            </Button>
            <JoinByCode />
          </div>
        </Panel>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Preferences</h2>
        <Panel tone="light" className="divide-y divide-line p-0">
          <div className="flex items-center justify-between px-card py-3.5">
            <span className="flex items-center gap-2.5">
              <ClockIcon className="h-5 w-5 text-ink-mute" />
              <span className="text-sm text-ink">Timezone</span>
            </span>
            <TimeZoneNote />
          </div>
          <div className="flex items-center justify-between px-card py-3.5">
            <span className="flex items-center gap-2.5">
              <DownloadIcon className="h-5 w-5 text-ink-mute" />
              <span className="text-sm text-ink">Install app</span>
            </span>
            <span className="text-xs text-ink-mute">Add to Home Screen</span>
          </div>
        </Panel>
        <p className="mt-2 px-1 text-xs text-ink-mute">
          Times shown in your device timezone. Install from your browser&apos;s share menu for a full-screen,
          app-like experience.
        </p>
      </div>

      {/* Logout */}
      <Button variant="outline" block onClick={handleLogout}>
        <LogOutIcon />
        Log out
      </Button>

      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

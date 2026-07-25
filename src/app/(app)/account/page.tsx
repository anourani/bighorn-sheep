"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Pill, StrikePips } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { CreateGroupModal } from "@/components/account/CreateGroupModal";
import { PlusIcon, LogOutIcon, DownloadIcon, ClockIcon, TrophyIcon } from "@/components/icons";
import { GROUP, MEMBERS, you } from "@/lib/mock/data";
import { strikeAllowance } from "@/lib/league/types";
import { timeZoneLabel } from "@/lib/time";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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

export default function AccountPage() {
  const me = you();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const allowance = strikeAllowance(GROUP.rules.eliminationType);
  const aliveCount = MEMBERS.filter((m) => m.status === "alive").length;

  return (
    <div className="stagger space-y-4">
      {/* Profile */}
      <div>
        <Panel className="p-card">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-sheen font-mono text-xl font-bold text-white ring-2 ring-white/20">
              {initials(me.name)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-onsurface">{me.name}</h1>
              <p className="truncate text-sm text-onsurface-soft">alex@bighorn.example</p>
              <div className="mt-2 flex items-center gap-2">
                {me.role === "admin" ? <Pill variant="brand">Admin</Pill> : <Pill variant="neutral">Player</Pill>}
                <MonoLabel className="text-onsurface-mute">Since Sep 2025</MonoLabel>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Leagues */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Your leagues</h2>
          <MonoLabel className="text-ink-mute">{aliveCount} alive</MonoLabel>
        </div>
        <Panel tone="light" className="divide-y divide-line p-0">
          <Link href="/group" className="flex items-center gap-3 px-card py-4 transition-colors hover:bg-[#FAFAFB]">
            <div className="grid h-10 w-10 place-items-center rounded-control bg-brand-wash text-brand-strong">
              <TrophyIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{GROUP.name}</div>
              <MonoLabel className="text-ink-mute">
                {GROUP.rules.eliminationType === "single" ? "Single elim" : "Two-time"} · {GROUP.rules.tieRule}
              </MonoLabel>
            </div>
            <div className="flex items-center gap-2">
              {me.status === "alive" ? <Pill variant="alive">Alive</Pill> : <Pill variant="out">Out</Pill>}
              <StrikePips strikes={me.strikes} allowance={allowance} tone="light" />
            </div>
          </Link>

          <div className="space-y-3 px-card py-4">
            <Button variant="outline" block onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create a group
            </Button>
            <div className="flex items-center gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter invite code"
                className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2.5 font-mono text-sm uppercase text-ink placeholder:font-sans placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
                aria-label="Invite code"
              />
              <Button variant="secondary" disabled={joinCode.trim().length === 0}>
                Join
              </Button>
            </div>
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
      <Link href="/login" className={buttonVariants({ variant: "outline", block: true })}>
        <LogOutIcon />
        Log out
      </Link>

      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { GearIcon, LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
import { RosterPanel } from "@/components/group/RosterPanel";
import {
  CURRENT_WEEK,
  DEMO_NOW,
  FINAL_WEEK,
  GROUP,
  MEMBERS,
  SEASON,
  gameForTeam,
  you,
} from "@/lib/mock/data";
import { seasonPhase } from "@/lib/game/season";
import type { Member } from "@/lib/league/types";

function rankMembers(members: Member[]): RankedMember[] {
  const ordered = [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "alive" ? -1 : 1;
    if (a.status === "alive") {
      if (a.strikes !== b.strikes) return a.strikes - b.strikes;
      return a.name.localeCompare(b.name);
    }
    const aw = a.eliminatedWeek ?? 0;
    const bw = b.eliminatedWeek ?? 0;
    if (aw !== bw) return bw - aw;
    return a.name.localeCompare(b.name);
  });
  return ordered.map((member, i) => ({ member, rank: i + 1 }));
}

export default function StandingsPage() {
  const me = you();
  const isAdmin = me.role === "admin";
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ranked = useMemo(() => rankMembers(MEMBERS), []);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://bighorn.example";
  const isPreseason = seasonPhase(new Date(GROUP.entryClosesAt), DEMO_NOW) === "preseason";

  return (
    <div className="stagger space-y-4">
      <div>
        <Panel className="p-card">
          <div className="flex items-start justify-between">
            <div>
              <MonoLabel className="text-onsurface-mute">Standings</MonoLabel>
              <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">{GROUP.name}</h1>
              <MonoLabel className="mt-1 block text-onsurface-mute">
                {isPreseason ? `Season ${SEASON} · Pre-season` : `Season ${SEASON} · Week ${CURRENT_WEEK}`}
              </MonoLabel>
            </div>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Group settings"
                className="grid h-10 w-10 place-items-center rounded-control bg-white/10 text-onsurface transition-colors hover:bg-white/[0.16]"
              >
                <GearIcon className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </Panel>
      </div>

      {isPreseason ? (
        <RosterPanel group={GROUP} members={MEMBERS} now={DEMO_NOW} appUrl={appUrl} />
      ) : (
        <>
          <div>
            <StandingsGrid
              ranked={ranked}
              viewerId={me.id}
              currentWeek={CURRENT_WEEK}
              finalWeek={FINAL_WEEK}
              rules={GROUP.rules}
              now={DEMO_NOW}
              gameForTeam={gameForTeam}
            />
          </div>

          <p className="flex items-center justify-center gap-1.5 px-2 text-center text-xs text-ink-mute">
            <LockIcon className="h-3.5 w-3.5" />
            Current-week picks stay hidden until each team&apos;s game kicks off.
          </p>
        </>
      )}

      {isAdmin ? (
        <AdminSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          group={GROUP}
          members={MEMBERS}
          appUrl={appUrl}
        />
      ) : null}
    </div>
  );
}

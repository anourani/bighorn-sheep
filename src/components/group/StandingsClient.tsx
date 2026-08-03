"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { GearIcon, LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
import { RosterPanel } from "@/components/group/RosterPanel";
import { buildGameIndex } from "@/lib/league/games";
import type { LeagueData } from "@/lib/league/load";
import type { Member } from "@/lib/league/types";

function rankMembers(members: Member[]): RankedMember[] {
  const ordered = [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "alive" ? -1 : 1;
    if (a.status === "alive") {
      if (a.strikes !== b.strikes) return a.strikes - b.strikes;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    const aw = a.eliminatedWeek ?? 0;
    const bw = b.eliminatedWeek ?? 0;
    if (aw !== bw) return bw - aw;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return ordered.map((member, i) => ({ member, rank: i + 1 }));
}

export function StandingsClient({ data }: { data: LeagueData }) {
  const { group, currentWeek, finalWeek, nowIso, phase, hiddenPickUserIds } = data;
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const me = data.members.find((m) => m.id === data.viewer.id);
  const isAdmin = me?.role === "admin";
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ranked = useMemo(() => rankMembers(data.members), [data.members]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://bighorn.example";
  const isPreseason = phase === "preseason";

  return (
    <div className="stagger space-y-4">
      <div>
        <Panel className="p-card">
          <div className="flex items-start justify-between">
            <div>
              <MonoLabel className="text-onsurface-mute">Standings</MonoLabel>
              <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">{group.name}</h1>
              <MonoLabel className="mt-1 block text-onsurface-mute">
                {isPreseason
                  ? `Season ${group.season} · Pre-season`
                  : `Season ${group.season} · Week ${currentWeek}`}
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
        <RosterPanel group={group} members={data.members} now={now} appUrl={appUrl} />
      ) : (
        <>
          <div>
            <StandingsGrid
              ranked={ranked}
              viewerId={data.viewer.id}
              currentWeek={currentWeek}
              finalWeek={finalWeek}
              rules={group.rules}
              now={now}
              gameForTeam={idx.gameForTeam}
              hiddenPickUserIds={hiddenPickUserIds}
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
          group={group}
          members={data.members}
          appUrl={appUrl}
        />
      ) : null}
    </div>
  );
}

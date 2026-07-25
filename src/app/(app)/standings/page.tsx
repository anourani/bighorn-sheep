"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Metric } from "@/components/ui/Metric";
import { GearIcon, LockIcon, TrophyIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
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
import { seasonState } from "@/lib/game/elimination";
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
  const aliveCount = MEMBERS.filter((m) => m.status === "alive").length;
  const outCount = MEMBERS.length - aliveCount;
  const season = seasonState(MEMBERS, { currentWeek: CURRENT_WEEK });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://bighorn.example";

  return (
    <div className="stagger space-y-4">
      <div>
        <Panel className="p-card">
          <div className="flex items-start justify-between">
            <div>
              <MonoLabel className="text-onsurface-mute">Standings</MonoLabel>
              <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">{GROUP.name}</h1>
              <MonoLabel className="mt-1 block text-onsurface-mute">
                Season {SEASON} · Week {CURRENT_WEEK}
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

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
            <Metric label="Alive" value={aliveCount} accent />
            <Metric label="Out" value={outCount} />
            <Metric label="Field" value={MEMBERS.length} />
          </div>

          <SeasonBanner season={season} />
        </Panel>
      </div>

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

function SeasonBanner({ season }: { season: ReturnType<typeof seasonState> }) {
  if (season.kind === "in_progress") {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-onsurface-mute">
        <span className="h-1.5 w-1.5 rounded-full bg-alive" />
        Season in progress — last survivor takes it, or Week 18 decides.
      </div>
    );
  }
  const label =
    season.kind === "winner"
      ? "We have a winner"
      : season.kind === "wipeout"
        ? "Wipeout week — admin resolution needed"
        : "Multiple survivors — admin resolution needed";
  return (
    <div className="mt-4 flex items-center gap-2 rounded-control bg-brand-sheen/90 px-3 py-2.5 text-sm font-medium text-white">
      <TrophyIcon className="h-4 w-4" />
      {label}
    </div>
  );
}

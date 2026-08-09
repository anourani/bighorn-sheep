"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { GearIcon, LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember, type WeekColumn } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
import { RosterPanel } from "@/components/group/RosterPanel";
import { buildGameIndex } from "@/lib/league/games";
import { PRE_WEEK, weekLabel, weekShortLabel } from "@/lib/nfl/calendar";
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
  const { group, currentWeek, finalWeek, nowIso, phase, hiddenPickUserIds, practice } = data;
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const me = data.members.find((m) => m.id === data.viewer.id);
  const isAdmin = me?.role === "admin";
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ranked = useMemo(() => rankMembers(data.members), [data.members]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://bighorn.example";
  const isPreseason = phase === "preseason";

  const practiceIdx = useMemo(
    () => (practice ? buildGameIndex(practice.games) : null),
    [practice],
  );

  /**
   * Practice standing, shaped as `Member[]` so the existing grid and ranking are
   * reused wholesale. Identity comes from the real membership row; status,
   * strikes, and history are the DERIVED preseason values — the real ones are
   * never touched, which is what makes the Week 1 reset free.
   */
  const practiceRanked = useMemo<RankedMember[] | null>(() => {
    if (!practice) return null;
    const merged: Member[] = data.members.map((m) => {
      const p = practice.members[m.id];
      return {
        ...m,
        status: p?.status ?? "alive",
        strikes: p?.strikes ?? 0,
        eliminatedWeek: p?.eliminatedWeek ?? null,
        history: p?.history ?? [],
        currentPick: p?.currentPick ?? null,
      };
    });
    return rankMembers(merged);
  }, [data.members, practice]);

  const practiceColumns = useMemo<WeekColumn[] | null>(() => {
    if (!practice) return null;
    return practice.weeks.map((week) => ({
      week,
      label: weekShortLabel(PRE_WEEK(week), { maxPreWeek: practice.maxPreWeek }),
    }));
  }, [practice]);

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
        <>
          <RosterPanel group={group} members={data.members} now={now} appUrl={appUrl} />

          {practice && practiceRanked && practiceColumns && practiceIdx ? (
            <div className="space-y-2">
              <div className="px-1">
                <MonoLabel className="text-ink-mute">Preseason practice</MonoLabel>
                <p className="mt-1 text-xs leading-relaxed text-ink-mute">
                  A real run-through — a wrong pick strikes you here too. None of it carries over:
                  this table disappears and everyone starts Week 1 alive, with all 32 teams
                  available.
                </p>
              </div>
              <StandingsGrid
                ranked={practiceRanked}
                viewerId={data.viewer.id}
                currentWeek={practice.currentWeek}
                finalWeek={practice.maxPreWeek}
                columns={practiceColumns}
                outLabel={(w) => weekLabel(PRE_WEEK(w), { maxPreWeek: practice.maxPreWeek })}
                rules={group.rules}
                now={now}
                gameForTeam={practiceIdx.gameForTeam}
                hiddenPickUserIds={practice.hiddenPickUserIds}
              />
            </div>
          ) : null}
        </>
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

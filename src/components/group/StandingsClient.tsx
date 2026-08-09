"use client";

import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember, type WeekColumn } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
import { LeagueDetails } from "@/components/group/LeagueDetails";
import { LeagueRulesModal } from "@/components/group/LeagueRulesModal";
import { InviteCta, WhosIn } from "@/components/group/WhosIn";
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
  const [rulesOpen, setRulesOpen] = useState(false);

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
    <div className="stagger space-y-6">
      <LeagueDetails
        group={group}
        members={data.members}
        viewerId={data.viewer.id}
        currentWeek={currentWeek}
        phase={phase}
        practice={practice}
        isAdmin={isAdmin}
        onOpenRules={() => setRulesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {isPreseason ? (
        practice && practiceRanked && practiceColumns && practiceIdx ? (
          <section>
            <SectionHeader title="Practice standings" />
            <p className="mb-4 mt-2 text-xs leading-relaxed text-ink-mute">
              A real run-through — a wrong pick strikes you here too. None of it carries over: this
              table disappears and everyone starts Week 1 alive, with all 32 teams available.
            </p>
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
          </section>
        ) : null
      ) : (
        <section>
          <SectionHeader title="Standings" />
          <div className="mt-4">
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

          <p className="mt-2 flex items-center justify-center gap-1.5 px-2 text-center text-xs text-ink-mute">
            <LockIcon className="h-3.5 w-3.5" />
            Current-week picks stay hidden until each team&apos;s game kicks off.
          </p>
        </section>
      )}

      <WhosIn members={data.members} preseason={isPreseason} />

      <InviteCta group={group} appUrl={appUrl} now={now} />

      <LeagueRulesModal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        group={group}
        members={data.members}
      />

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

"use client";

import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember, type WeekColumn } from "@/components/group/StandingsGrid";
import { AdminSettingsModal } from "@/components/group/AdminSettingsModal";
import { LeagueDetails } from "@/components/group/LeagueDetails";
import { LeagueRulesModal } from "@/components/group/LeagueRulesModal";
import { InviteCta, WhosIn } from "@/components/group/WhosIn";
import { StatusReport } from "@/components/app/StatusReport";
import { buildGameIndex } from "@/lib/league/games";
import { rankMembers, survivorCounts, type StatusLineInput } from "@/lib/league/view";
import { PRE_WEEK, weekShortLabel } from "@/lib/nfl/calendar";
import { countdown } from "@/lib/time";
import type { LeagueData } from "@/lib/league/load";
import type { Member } from "@/lib/league/types";

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
   * What the status report reads, in the one shape `statusLine()` takes. The
   * week is `currentWeek`, so the "Week 6" in that heading follows the season
   * without anyone editing it.
   *
   * `now` is the server's `nowIso`, so the pre-season countdown is stamped at
   * render and deliberately does not tick — see the note at load.ts:335-337.
   */
  const status = useMemo<StatusLineInput>(() => {
    if (isPreseason) {
      return {
        kind: "preseason",
        joined: data.members.length,
        startsIn: countdown(new Date(group.entryClosesAt), now).label,
      };
    }
    const { alive, eliminated } = survivorCounts(data.members);
    return { kind: "season", week: currentWeek, alive, eliminated };
  }, [isPreseason, data.members, group.entryClosesAt, now, currentWeek]);

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

  /**
   * The practice weeks, then the regular season previewed behind them, so the
   * table shows the whole season's shape instead of four columns and a stretch
   * of empty panel. The previewed columns carry no picks — see `WeekColumn`.
   *
   * Labelled W1…W18 rather than the bare numbers the real standings grid uses:
   * only here do they sit immediately after P1…P3, where a lone "1" beside "P3"
   * reads as one more preseason week.
   */
  const practiceColumns = useMemo<WeekColumn[] | null>(() => {
    if (!practice) return null;
    return [
      ...practice.weeks.map((week) => ({
        week,
        label: weekShortLabel(PRE_WEEK(week), { maxPreWeek: practice.maxPreWeek }),
      })),
      ...Array.from({ length: finalWeek }, (_, i) => ({
        week: i + 1,
        label: `W${i + 1}`,
        preview: true,
      })),
    ];
  }, [finalWeek, practice]);

  return (
    <div className="stagger space-y-6">
      <LeagueDetails
        group={group}
        members={data.members}
        currentWeek={currentWeek}
        phase={phase}
        isAdmin={isAdmin}
        onOpenRules={() => setRulesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* py-3 rather than the landing page's py-5: the mockup's 12px, and the
          shell's `main` already supplies the horizontal inset. */}
      <StatusReport status={status} className="py-3" />

      {isPreseason ? (
        practice && practiceRanked && practiceColumns && practiceIdx ? (
          <section>
            <SectionHeader title="Practice Standings" />
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

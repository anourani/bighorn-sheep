"use client";

import { useMemo, useRef, useState } from "react";
import { StatusHero } from "@/components/picks/StatusHero";
import { CurrentPickCard } from "@/components/picks/CurrentPickCard";
import { TeamGrid } from "@/components/picks/TeamGrid";
import { LookAhead, type LookAheadWeek } from "@/components/picks/LookAhead";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { LocalTime } from "@/components/ui/LocalTime";
import { InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import {
  BYES_BY_WEEK,
  CURRENT_WEEK,
  DEMO_NOW,
  GROUP,
  MEMBERS,
  WEEK_GAMES,
  gameForTeam,
  weekFinalKickoff,
  you,
} from "@/lib/mock/data";
import { buildTeamStates, countStates, isHome, opponentOf } from "@/lib/league/view";

export default function MyPicksPage() {
  const me = you();
  const now = DEMO_NOW;
  const week = CURRENT_WEEK;
  const rules = GROUP.rules;

  const [pickTeam, setPickTeam] = useState<TeamId | null>(me.currentPick?.teamId ?? null);
  const [confirmTeam, setConfirmTeam] = useState<TeamId | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const aliveCount = MEMBERS.filter((m) => m.status === "alive").length;
  const byes = BYES_BY_WEEK[week] ?? [];

  const states = useMemo(() => {
    const effective = {
      ...me,
      currentPick: pickTeam
        ? { week, teamId: pickTeam, gameId: gameForTeam(week, pickTeam)?.id ?? "" }
        : null,
    };
    return buildTeamStates(effective, week, byes);
  }, [me, pickTeam, week, byes]);

  const counts = countStates(states);
  const pickGame = pickTeam ? gameForTeam(week, pickTeam) : undefined;
  const usedTeams = useMemo(() => new Set(me.history.map((h) => h.teamId)), [me.history]);

  const lookaheadWeeks: LookAheadWeek[] = useMemo(
    () =>
      [1, 2, 3, 4].map((offset) => {
        const w = week + offset;
        return { week: w, games: WEEK_GAMES[w] ?? [], byes: BYES_BY_WEEK[w] ?? [] };
      }),
    [week],
  );

  function scrollToGrid() {
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const confirmGame = confirmTeam ? gameForTeam(week, confirmTeam) : undefined;
  const confirmTeamObj = confirmTeam ? getTeam(confirmTeam) : undefined;
  const replacing = pickTeam && confirmTeam && pickTeam !== confirmTeam ? getTeam(pickTeam) : undefined;

  return (
    <div className="stagger space-y-4">
      <div>
        <StatusHero
          member={me}
          rules={rules}
          aliveCount={aliveCount}
          totalCount={MEMBERS.length}
          week={week}
        />
      </div>

      <div>
        <CurrentPickCard
          teamId={pickTeam}
          game={pickGame}
          week={week}
          rules={rules}
          now={now}
          weekFinalKickoff={weekFinalKickoff(week)}
          onChange={scrollToGrid}
        />
      </div>

      <div ref={gridRef} className="scroll-mt-20 pt-1">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Pick your team</h2>
          <MonoLabel className="text-ink-mute">Tap to select</MonoLabel>
        </div>
        <TeamGrid states={states} counts={counts} onSelect={(t) => setConfirmTeam(t)} />
      </div>

      <div>
        <LookAhead weeks={lookaheadWeeks} usedTeams={usedTeams} />
      </div>

      <Modal
        open={confirmTeam !== null}
        onClose={() => setConfirmTeam(null)}
        eyebrow={`Week ${week} pick`}
        title={confirmTeamObj ? `Pick the ${confirmTeamObj.name}?` : "Confirm pick"}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" block onClick={() => setConfirmTeam(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              block
              onClick={() => {
                if (confirmTeam) setPickTeam(confirmTeam);
                setConfirmTeam(null);
              }}
            >
              Confirm pick
            </Button>
          </div>
        }
      >
        {confirmTeamObj ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-control border border-line bg-[#FAFAFB] p-3">
              <span
                className="h-10 w-10 rounded-[10px] ring-1 ring-black/10"
                style={{ backgroundColor: confirmTeamObj.color }}
                aria-hidden
              />
              <div>
                <div className="font-mono text-lg font-bold tracking-wide text-ink">{confirmTeamObj.abbr}</div>
                <div className="text-sm text-ink-soft">
                  {confirmTeamObj.location} {confirmTeamObj.name}
                </div>
              </div>
              {confirmGame ? (
                <div className="ml-auto text-right text-sm text-ink-soft">
                  {isHome(confirmGame, confirmTeam!) ? "vs" : "@"}{" "}
                  {getTeam(opponentOf(confirmGame, confirmTeam!))?.abbr}
                  <div className="mt-0.5">
                    <LocalTime iso={confirmGame.kickoff} className="font-mono text-xs text-ink-mute" />
                  </div>
                </div>
              ) : null}
            </div>

            {replacing ? (
              <p className="text-sm text-ink-soft">
                This replaces your current pick, the{" "}
                <span className="font-medium text-ink">{replacing.name}</span>.
              </p>
            ) : null}

            <div className="flex items-start gap-2 rounded-control bg-brand-wash px-3 py-2.5 text-xs leading-relaxed text-[#8A4A24]">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You can change this freely until kickoff. Once locked, the {confirmTeamObj.name} are used for the
                season — you can&apos;t pick them again.
              </span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { PickHero } from "@/components/picks/PickHero";
import { WeekSchedule, type UsedPick } from "@/components/picks/WeekSchedule";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { LocalTime } from "@/components/ui/LocalTime";
import { ChevronDownIcon, InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import {
  PRE_WEEK,
  REGULAR_WEEK,
  groupedWeekOptions,
  parseWeekKey,
  sameWeek,
  weekKey,
  weekLabel,
  type WeekRef,
} from "@/lib/nfl/calendar";
import { buildGameIndex } from "@/lib/league/games";
import { pickForWeek, viewerPicksByWeek, type PendingPicks } from "@/lib/league/picks";
import type { LeagueData } from "@/lib/league/load";
import { submitPick } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";

/** Friendly copy for a rejected pick (mirrors the canPick reason codes). */
const PICK_ERROR: Record<string, string> = {
  team_already_used: "You've already used that team.",
  game_kicked_off: "That game has kicked off — pick locked.",
  eliminated: "You're eliminated, so picks are closed.",
  no_game_for_team: "That team isn't playing this week.",
  entry_closed: "Entry for this league has closed.",
  not_a_member: "You're not a member of this league.",
  practice_closed: "Preseason practice is over — the regular season has started.",
  no_practice_schedule: "There's no preseason schedule loaded to practise against.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

export function MyPicksClient({ data }: { data: LeagueData }) {
  const { group, currentWeek, finalWeek, nowIso, phase, practice } = data;
  const me = data.members.find((m) => m.id === data.viewer.id);
  const practiceMe = practice?.members[data.viewer.id];
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const isPreseason = phase === "preseason";

  // Two indexes over two disjoint slices of the schedule. Deliberately NOT one
  // index over both: buildGameIndex keys on week number alone, so preseason week 2
  // and regular week 2 would share a bucket and gameForTeam would return whichever
  // row arrived first.
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const practiceIdx = useMemo(
    () => (practice ? buildGameIndex(practice.games) : null),
    [practice],
  );

  const weekGroups = useMemo(
    () =>
      groupedWeekOptions({
        currentWeek,
        finalWeek,
        practice: practice ? { weeks: practice.weeks, currentWeek: practice.currentWeek } : null,
      }),
    [currentWeek, finalWeek, practice],
  );

  // Defaults to the live regular week, as it always has. The real Week 1 pick is
  // the league-critical action; practice is one dropdown away and called out in
  // the banner.
  const [viewKey, setViewKey] = useState(() => weekKey(REGULAR_WEEK(currentWeek)));

  // A week that has left the dropdown must not stay selected. Entry closing with
  // the tab open drops `practice` to null while `viewKey` still reads "pre:N",
  // and every lookup below then reads the REGULAR season's week N while the
  // heading still says "Preseason N".
  const optionKeys = useMemo(
    () => new Set(weekGroups.flatMap((g) => g.options.map((o) => o.key))),
    [weekGroups],
  );
  const selectedKey = optionKeys.has(viewKey) ? viewKey : weekKey(REGULAR_WEEK(currentWeek));
  const viewRef: WeekRef = parseWeekKey(selectedKey) ?? REGULAR_WEEK(currentWeek);
  const viewingPractice = viewRef.seasonType === "pre" && practice !== null;

  // Picks indexed by week across both phases, so this screen can answer "what
  // did I pick for THIS week" and not merely "what is my pick right now".
  //
  // Derived from props rather than seeded into state: submitPick's
  // revalidatePath refreshes this component's props WITHOUT remounting it, so a
  // useState initializer never re-runs — which is how the pick stayed pinned to
  // whichever week was live when the tab was first opened.
  const serverPicks = useMemo(
    () =>
      viewerPicksByWeek({
        history: me?.history,
        currentPick: me?.currentPick ?? null,
        practicePicks: practiceMe?.picks,
      }),
    [me, practiceMe],
  );
  // The optimistic overlay, keyed by week so an in-flight pick can never be
  // painted under a different week's label.
  const [pendingPicks, setPendingPicks] = useState<PendingPicks>(() => new Map());
  const [pickError, setPickError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const labelOpts = { maxPreWeek: practice?.maxPreWeek ?? 0 };
  const viewName = weekLabel(viewRef, labelOpts);

  // Everything below is "whichever phase you're looking at".
  const activeIdx = viewingPractice && practiceIdx ? practiceIdx : idx;
  const liveWeek = viewingPractice && practice ? practice.currentWeek : currentWeek;
  const liveRef = viewingPractice ? PRE_WEEK(liveWeek) : REGULAR_WEEK(liveWeek);
  const liveName = weekLabel(liveRef, labelOpts);
  // sameWeek, not a bare week-number compare: preseason week N is not regular
  // week N, and conflating them let a preview render as though it were live.
  const isCurrent = sameWeek(viewRef, liveRef);
  // The pick for the week the dropdown names — not the phase's live week, which
  // left the banner contradicting the schedule underneath it.
  const pickTeam = pickForWeek(viewRef, serverPicks, pendingPicks);

  const games = useMemo(() => {
    const source = viewingPractice && practice ? practice.games : data.games;
    return source
      .filter((g) => g.week === viewRef.week)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }, [data.games, practice, viewingPractice, viewRef.week]);

  const byes = activeIdx.byesForWeek(viewRef.week);

  // Teams already spent in THIS phase. Practice and the regular season keep
  // separate used-team lists — a team practised in preseason is available again at
  // Week 1 — which the database enforces via
  // unique (group_id, user_id, season_type, team_id).
  //
  // Practice reads `picks` rather than `history`: history only holds picks whose
  // game has produced a result, and an unresolved pick still spends its team. With
  // no scorer running nothing resolves at all, so a history-based list would
  // re-offer spent teams and the database would reject the pick.
  //
  // The week on screen is excluded from its own used list: your pick there is a
  // selection you may still replace, not a team you have spent. Same exclusion
  // submitPick applies via practiceUsedTeams(me, { excludeWeek }) — without it
  // the team the banner highlights also renders struck through as "Used · Wn".
  const usedByTeam = useMemo(() => {
    const entries: [TeamId, UsedPick][] = viewingPractice
      ? (practiceMe?.picks ?? [])
          .filter((p) => p.week !== viewRef.week)
          .map((p) => [p.teamId, { week: p.week }])
      : (me?.history ?? [])
          // A no-op today — history is weeks < currentWeek and the regular
          // dropdown is forward-only — but kept symmetric with practice.
          .filter((h) => h.week !== viewRef.week)
          .map((h) => [h.teamId, { week: h.week }]);
    return new Map<TeamId, UsedPick>(entries);
  }, [me, practiceMe, viewingPractice, viewRef.week]);

  // The VIEWED week's fixture. Resolving it against liveWeek instead found that
  // team's game in a completely different week and rendered its opponent,
  // kickoff and countdown as fact — a matchup the member never picked.
  const pickGame = pickTeam ? activeIdx.gameForTeam(viewRef.week, pickTeam) : undefined;

  // Nothing left to count down to once a week's last kickoff has passed;
  // countdown() answers "now" for a past target, so drop the line instead.
  const weekDeadline = activeIdx.weekFinalKickoff(viewRef.week);
  const viewDeadline = weekDeadline && weekDeadline > now ? weekDeadline : null;

  function handleSelect(teamId: TeamId) {
    // A previewed week is read-only. WeekSchedule already refuses to fire, but
    // the server derives the week itself: a slipped call would quietly write the
    // live week while the screen names another one.
    if (!isCurrent) return;

    const forPractice = viewingPractice;
    // Keyed to the live week — the only week submitPick will ever write.
    const key = weekKey(liveRef);
    const previous = pickForWeek(liveRef, serverPicks, pendingPicks);
    const set = (team: TeamId | null) =>
      setPendingPicks((m) => new Map(m).set(key, team));

    set(teamId); // optimistic
    setPickError(null);
    startTransition(async () => {
      try {
        const res = await submitPick({
          groupId: group.id,
          teamId,
          seasonType: forPractice ? "pre" : "regular",
        });
        if (!res.ok) {
          set(previous); // revert on rejection
          setPickError(PICK_ERROR[res.error] ?? "Couldn't save that pick. Try again.");
        }
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        set(previous); // revert on rejection
        setPickError("Couldn't save that pick. Try again.");
      }
    });
  }

  return (
    <div className="stagger space-y-4">
      {isPreseason ? (
        <div className="rounded-card border border-brand/30 bg-brand-wash px-4 py-3">
          <MonoLabel className="text-[#8A4A24]">Pre-season</MonoLabel>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            The season kicks off{" "}
            <LocalTime iso={group.entryClosesAt} mode="full" className="font-semibold" />. Make your Week 1
            pick now — it locks when your team plays, and you can change it anytime until then.
          </p>
          {practice ? (
            <p className="mt-2 text-sm leading-relaxed text-ink">
              Want a dry run first? Switch the week dropdown to{" "}
              <span className="font-semibold">Preseason</span> and play the practice round. It works
              exactly like the real thing — a wrong pick strikes you — but{" "}
              <span className="font-semibold">everything resets for Week 1</span>: strikes clear,
              eliminated players come back, and every team is available again.
            </p>
          ) : null}
        </div>
      ) : null}

      <PickHero
        weekName={viewName}
        practice={viewingPractice}
        teamId={pickTeam}
        game={pickGame}
        now={now}
        weekFinalKickoff={viewDeadline}
      />

      {pickError ? (
        <div className="flex items-start gap-2 rounded-control border border-out/30 bg-out-wash px-3 py-2.5 text-sm text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pickError}</span>
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <MonoLabel className="text-ink-mute">{viewName}</MonoLabel>
            <h2 className="mt-0.5 text-sm font-semibold text-ink">Schedule</h2>
          </div>

          <label className="block">
            <MonoLabel className="mb-1.5 block text-ink-mute">Change week</MonoLabel>
            <div className="relative">
              <select
                value={selectedKey}
                onChange={(e) => {
                  setViewKey(e.target.value);
                  // Don't leave one week's rejection hanging over the next.
                  setPickError(null);
                }}
                className="w-full min-w-[9.5rem] appearance-none rounded-control border border-line bg-white px-3 py-2 pr-9 text-sm font-medium text-ink transition-colors focus-visible:border-brand-strong focus-visible:outline-none"
              >
                {weekGroups.map((groupOpt, i) =>
                  groupOpt.label === null ? (
                    groupOpt.options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                        {o.isCurrent ? " · current" : ""}
                      </option>
                    ))
                  ) : (
                    <optgroup key={groupOpt.label ?? i} label={groupOpt.label}>
                      {groupOpt.options.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                          {o.isCurrent ? " · current" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ),
                )}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
            </div>
          </label>
        </div>

        {!isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Picks are open for{" "}
            <span className="font-semibold text-ink-soft">{liveName}</span> only —
            you&apos;re previewing {viewName}. Used teams stay flagged so you can plan ahead.
          </p>
        ) : null}

        {viewingPractice && isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Practice round — this pick doesn&apos;t carry into the regular season, and neither does
            the result.
          </p>
        ) : null}

        {byes.length > 0 ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            {viewingPractice ? "Not playing this week" : "On bye this week"}:{" "}
            <span className="font-mono font-semibold text-ink-soft">
              {byes.map((b) => getTeam(b)?.abbr).filter(Boolean).join(", ")}
            </span>{" "}
            — not pickable.
          </p>
        ) : null}

        <WeekSchedule
          weekRef={viewRef}
          weekName={viewName}
          games={games}
          usedByTeam={usedByTeam}
          selectedTeam={pickTeam}
          interactive={isCurrent && !saving}
          now={now}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}

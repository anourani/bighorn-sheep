"use client";

import { useMemo, useState, useTransition } from "react";
import { PickHero } from "@/components/picks/PickHero";
import { PickFilters } from "@/components/picks/PickFilters";
import { TeamGrid } from "@/components/picks/TeamGrid";
import { WeekStrip } from "@/components/picks/WeekStrip";
import { WeekSchedule, type UsedPick } from "@/components/picks/WeekSchedule";
import { GRID_LAYOUTS, GRID_SORTS } from "@/components/picks/team-grid";
import { Label } from "@/components/ui/Label";
import { LocalTime } from "@/components/ui/LocalTime";
import { InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import {
  PRE_WEEK,
  REGULAR_WEEK,
  parseWeekKey,
  sameWeek,
  weekKey,
  weekLabel,
  weekStripOptions,
  type WeekRef,
} from "@/lib/nfl/calendar";
import { buildGameIndex } from "@/lib/league/games";
import { pickForWeek, viewerPicksByWeek, type PendingPicks } from "@/lib/league/picks";
import { recordsThroughWeek } from "@/lib/league/records";
import type { LeagueData } from "@/lib/league/load";
import { submitPick } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { PICKS_LAYOUT_KEY, PICKS_SORT_KEY } from "@/lib/prefs";
import { useStoredChoice } from "@/lib/use-stored-choice";

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

  const weekOptions = useMemo(
    () =>
      weekStripOptions({
        currentWeek,
        finalWeek,
        practice: practice ? { weeks: practice.weeks, currentWeek: practice.currentWeek } : null,
      }),
    [currentWeek, finalWeek, practice],
  );

  // Defaults to the live regular week, as it always has. The real Week 1 pick is
  // the league-critical action; practice is one chip away and called out in
  // the banner.
  const [viewKey, setViewKey] = useState(() => weekKey(REGULAR_WEEK(currentWeek)));

  // A week that has left the strip must not stay selected. Entry closing with
  // the tab open drops `practice` to null while `viewKey` still reads "pre:N",
  // and every lookup below then reads the REGULAR season's week N while the
  // heading still says "Preseason N".
  const optionKeys = useMemo(() => new Set(weekOptions.map((o) => o.key)), [weekOptions]);
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

  // How this browser likes to look at the week. Deliberately not part of
  // LeagueData: it says nothing about the league, and a profile column would
  // have meant a migration applied to production by hand. The first paint uses
  // the defaults and swaps after hydration — see useStoredChoice.
  const [layout, setLayout] = useStoredChoice(PICKS_LAYOUT_KEY, GRID_LAYOUTS, "grid");
  const [sort, setSort] = useStoredChoice(PICKS_SORT_KEY, GRID_SORTS, "record");

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
  // The strip carries the whole season now, so a preview can be behind the live
  // week as well as ahead of it, and the two want different copy. A bare week
  // compare is safe here: `selectedKey` can only name a week the strip offers,
  // and the strip only offers preseason weeks while `liveRef` is a preseason
  // one, so the two refs always share a `seasonType`.
  const viewingPast = !isCurrent && viewRef.week < liveRef.week;
  // The pick for the week the strip names — not the phase's live week, which
  // left the banner contradicting the schedule underneath it.
  const pickTeam = pickForWeek(viewRef, serverPicks, pendingPicks);

  // What the strip draws inside each chip. Built here rather than in WeekStrip
  // so this stays the only component that knows how server truth and the
  // optimistic overlay combine — and so a pick lights its own chip the instant
  // it's made, before the server has answered.
  const pickedByWeek = useMemo(() => {
    const byWeek = new Map<string, TeamId>();
    for (const option of weekOptions) {
      const team = pickForWeek(option.ref, serverPicks, pendingPicks);
      if (team) byWeek.set(option.key, team);
    }
    return byWeek;
  }, [weekOptions, serverPicks, pendingPicks]);

  const games = useMemo(() => {
    const source = viewingPractice && practice ? practice.games : data.games;
    return source
      .filter((g) => g.week === viewRef.week)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }, [data.games, practice, viewingPractice, viewRef.week]);

  const byes = activeIdx.byesForWeek(viewRef.week);

  // Always the regular-season schedule, even while viewing a practice week:
  // preseason results are not season results. A practice week is numbered 1-4,
  // so the cutoff leaves nothing to count and every card reads 0-0 — which is
  // correct, and what the mockups show.
  const records = useMemo(
    () => recordsThroughWeek(data.games, viewRef.week),
    [data.games, viewRef.week],
  );

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
  // Two exclusions, and the second only became reachable with the week strip.
  //
  // The week on screen is excluded from its own used list: your pick there is a
  // selection you may still replace, not a team you have spent. Same exclusion
  // submitPick applies via practiceUsedTeams(me, { excludeWeek }) — without it
  // the team the banner highlights also renders struck through as "Used · Wn".
  //
  // And when you are looking BACKWARDS, every week after the one on screen goes
  // too. The old dropdown was forward-only, so this could not arise; the strip
  // offers the whole season, and without the cut Week 3 flags a team as
  // "Used · W10" — spent in a week that, from where you are standing, has not
  // been played. Current and future views keep the whole list, which is what
  // makes the "plan ahead" note below true.
  const usedByTeam = useMemo(() => {
    const counts = (week: number) =>
      week !== viewRef.week && !(viewingPast && week > viewRef.week);
    const entries: [TeamId, UsedPick][] = viewingPractice
      ? (practiceMe?.picks ?? [])
          .filter((p) => counts(p.week))
          .map((p) => [p.teamId, { week: p.week }])
      : (me?.history ?? [])
          .filter((h) => counts(h.week))
          .map((h) => [h.teamId, { week: h.week }]);
    return new Map<TeamId, UsedPick>(entries);
  }, [me, practiceMe, viewingPractice, viewingPast, viewRef.week]);

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
      {/* `selectedKey`, not raw `viewKey` — a week that has dropped out of the
          options must not stay selected. See the sanitising above. */}
      <WeekStrip
        options={weekOptions}
        value={selectedKey}
        picked={pickedByWeek}
        onChange={(key) => {
          setViewKey(key);
          // Don't leave one week's rejection hanging over the next.
          setPickError(null);
        }}
      />

      {isPreseason ? (
        <div className="rounded-card border border-brand/30 bg-brand-wash px-4 py-3">
          <Label className="text-[#8A4A24]">Pre-season</Label>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            The season kicks off{" "}
            <LocalTime iso={group.entryClosesAt} mode="full" className="font-semibold" />. Make your Week 1
            pick now — it locks when your team plays, and you can change it anytime until then.
          </p>
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
        {/* Replaces the visible "Schedule" heading the week strip absorbed, so
            heading-jump navigation still reaches the grid. */}
        <h2 className="sr-only">Schedule</h2>

        <PickFilters
          layout={layout}
          onLayoutChange={setLayout}
          sort={sort}
          onSortChange={setSort}
          className="mb-4"
        />

        {!isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Picks are open for{" "}
            <span className="font-semibold text-ink-soft">{liveName}</span> only —
            you&apos;re previewing {viewName}.{" "}
            {viewingPast
              ? "That week has already been played."
              : "Used teams stay flagged so you can plan ahead."}
          </p>
        ) : null}

        {viewingPractice && isCurrent ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Practice round — this pick doesn&apos;t carry into the regular season, and neither does
            the result.
          </p>
        ) : null}

        {/* The matchup layout only lists the week's fixtures, so a team that
            isn't playing is simply absent and has to be named here. The grid
            renders all 32 either way and says "BYE Week" on the card itself,
            which makes this line a second, staler copy of the same fact. */}
        {byes.length > 0 && layout === "matchups" ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            {viewingPractice ? "Not playing this week" : "On bye this week"}:{" "}
            <span className="font-semibold text-ink-soft">
              {byes.map((b) => getTeam(b)?.abbr).filter(Boolean).join(", ")}
            </span>{" "}
            — not pickable.
          </p>
        ) : null}

        {/* Both layouts are handed the same derived values — the week's games,
            the used-team list with its two week-scoped exclusions, the pick and
            whether this week is live. A new rule about what is pickable is added
            once, above, and both surfaces get it. */}
        {layout === "grid" ? (
          <TeamGrid
            weekRef={viewRef}
            weekName={viewName}
            games={games}
            usedByTeam={usedByTeam}
            selectedTeam={pickTeam}
            interactive={isCurrent && !saving}
            now={now}
            sort={sort}
            records={records}
            onSelect={handleSelect}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}

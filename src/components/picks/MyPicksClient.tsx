"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PickHero } from "@/components/picks/PickHero";
import { PickStickyBar } from "@/components/picks/PickStickyBar";
import { PickFilters } from "@/components/picks/PickFilters";
import { TeamGrid } from "@/components/picks/TeamGrid";
import { WeekStrip } from "@/components/picks/WeekStrip";
import { WeekSchedule, type UsedPick } from "@/components/picks/WeekSchedule";
import { GRID_LAYOUTS } from "@/components/picks/team-grid";
import { IDLE_QUEUE, settlePick, tapPick, type PickQueue } from "@/components/picks/pick-queue";
import { buildChipPicks } from "@/components/picks/week-strip";
import { Toast } from "@/components/ui/Toast";
import { raiseToast, releaseMessage, type ToastMessage } from "@/components/ui/toast";
import { InfoIcon } from "@/components/icons";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff } from "@/lib/nfl/types";
import {
  PRE_WEEK,
  REGULAR_WEEK,
  parseWeekKey,
  sameWeek,
  weekKey,
  weekLabel,
  weekShortName,
  weekStripOptions,
  type WeekRef,
} from "@/lib/nfl/calendar";
import { buildGameIndex } from "@/lib/league/games";
import {
  committedWeek,
  pickForWeek,
  pruneAgreedPicks,
  viewerPicksByWeek,
  type PendingPicks,
} from "@/lib/league/picks";
import { recordsThroughWeek } from "@/lib/league/records";
import type { LeagueData, ViewerEntry } from "@/lib/league/load";
import type { EntryNo } from "@/lib/league/types";
import { EntryTabs } from "./EntryTabs";
import { AddEntryCta } from "@/components/app/AddEntryCta";
import { submitPick } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { PICKS_ENTRY_KEY, PICKS_LAYOUT_KEY } from "@/lib/prefs";
import { useStoredChoice } from "@/lib/use-stored-choice";

/** Friendly copy for a rejected pick (mirrors the canPick reason codes). */
/**
 * The stored entry choice, as strings because `readStoredChoice` narrows a
 * `string | null` against a union of strings. Compared back with
 * `String(e.entryNo)`, which keeps the storage contract in one place rather
 * than adding a parse that could disagree with it.
 */
const ENTRY_CHOICES = ["1", "2"] as const;

const PICK_ERROR: Record<string, string> = {
  team_already_used: "You've already used that team.",
  game_kicked_off: "That game has kicked off — pick locked.",
  eliminated: "You're eliminated, so picks are closed.",
  no_game_for_team: "That team isn't playing this week.",
  entry_closed: "Entry for this league has closed.",
  not_a_member: "You're not a member of this league.",
  practice_closed: "Preseason practice is over — the regular season has started.",
  practice_not_enabled: "Your admin hasn't turned on preseason practice for you.",
  no_practice_schedule: "There's no preseason schedule loaded to practise against.",
  bad_week: "That week isn't part of this season.",
  week_already_started: "That week has already started — its picks are locked.",
  // The one code that reports a PARTIAL write: the team was freed from its old
  // week and the new pick then failed to save. Saying "try again" without saying
  // that would leave them to find the hole themselves.
  release_failed: "We freed that team up, but couldn't save the new pick. Try again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

export function MyPicksClient({ data }: { data: LeagueData }) {
  const { group, currentWeek, finalWeek, nowIso, practice } = data;
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  /*
   * WHICH ENTRY IS BEING PLAYED (0017).
   *
   * Per-device like the layout beside it, and for a stronger reason: switching
   * tabs writes nothing — the entry rides on each `submitPick` call — so a stale
   * value in one browser cannot desync anything. `useStoredChoice` seeds with
   * the fallback and reads storage in an effect, so "1" is the server paint and
   * anyone who last looked at entry 2 lands back on it after hydration.
   *
   * `entries` falls back to a synthetic entry 1 rather than going empty. A
   * viewer with no membership row does not reach this component (the page
   * renders `NoLeagueState`), but the array is indexed unconditionally below and
   * an empty one would mean `activeEntry` was undefined on a path nothing
   * guards.
   */
  const entries: ViewerEntry[] =
    data.viewerEntries.length > 0
      ? data.viewerEntries
      : [{ memberId: data.viewer.id, entryNo: 1, picks: data.viewerPicks, practiceEnabled: true }];
  const [entryChoice, setEntryChoice] = useStoredChoice(PICKS_ENTRY_KEY, ENTRY_CHOICES, "1");
  // The STORED choice is a preference; the entries are the fact. Somebody whose
  // second entry was removed in the SQL editor still has "2" in localStorage,
  // and must land on the entry they actually hold rather than on nothing.
  const activeEntry = entries.find((e) => String(e.entryNo) === entryChoice) ?? entries[0]!;
  const activeEntryNo = activeEntry.entryNo;

  // Practice is keyed by MEMBERSHIP id since 0017, not by user id — so this
  // reads the practice record of the entry on screen. Keyed on the person, a
  // two-entry player would have seen entry 1's practice round under both tabs.
  const practiceMe = practice?.members[activeEntry.memberId];

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
        // The ACTIVE entry's picks, not `data.viewerPicks` (which is entry 1's).
        // Everything downstream — the hero, the chips, the used-team set, the
        // grid — reads this one map, so scoping it here scopes all of them.
        regularPicks: activeEntry.picks,
        practicePicks: practiceMe?.picks,
      }),
    [activeEntry.picks, practiceMe],
  );
  // The optimistic overlay, keyed by week so an in-flight pick can never be
  // painted under a different week's label.
  const [pendingPicks, setPendingPicks] = useState<PendingPicks>(() => new Map());
  const [pickError, setPickError] = useState<string | null>(null);
  // The released-pick message. Null when there is nothing to say; a new id
  // replays the entrance even when the sentence is identical.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // The pending boolean is discarded on purpose — the grid must stay tappable
  // while a pick saves (the overlay above is the acknowledgment; the queue
  // below is what makes overlapping taps safe). The transition itself is kept
  // so the revalidated RSC payload applies without blocking paint, the same
  // trade AdminSettingsDrawer makes.
  const [, startTransition] = useTransition();
  // Per-week submit chains — single-flight with a trailing tap, see
  // pick-queue.ts. A ref, not state: nothing in it drives rendering; the
  // visible pieces are pendingPicks, pickError and toast above. Keyed by
  // weekKey, which is why picking ahead needed nothing here: every writable
  // week already ran its own chain, where before only two ever could (the live
  // practice week and regular Week 1 during the preseason).
  const queuesRef = useRef(new Map<string, PickQueue>());

  /*
   * Submit chains are per ENTRY per week, not per week (0017).
   *
   * Two entries may hold picks for the same week at the same time, and each
   * needs its own single-flight chain — sharing one would let entry 2's tap
   * settle entry 1's in-flight request and revert to the wrong team. The key is
   * prefixed rather than the map being nested because everything that touches
   * it already passes a week key around; one helper keeps that true.
   */
  const queueKey = (entryNo: EntryNo, key: string) => `${entryNo}|${key}`;

  // The entry currently on screen, readable from inside an async settle without
  // capturing a stale value. `activeEntryNo` in a closure would be whatever it
  // was when the request was launched, which is precisely the value the check
  // has to compare AGAINST.
  const activeEntryRef = useRef(activeEntryNo);
  useEffect(() => {
    activeEntryRef.current = activeEntryNo;
  }, [activeEntryNo]);

  /*
   * The optimistic overlay is dropped when the entry changes.
   *
   * It is keyed by week alone, deliberately: it is compared against
   * `serverPicks` by `pruneAgreedPicks`, and prefixing one side and not the
   * other would stop every entry ever pruning. Since `serverPicks` is rebuilt
   * from the newly-active entry, an overlay left over from the previous one
   * would be painted against the wrong truth — so it goes.
   *
   * What is NOT lost is the write: a pick already sent is settled by its own
   * (entry-prefixed) chain and lands through revalidation. The only cost of
   * switching tabs mid-flight is that the tick appears a moment later.
   */
  useEffect(() => {
    setPendingPicks(new Map());
  }, [activeEntryNo]);

  // Retire each overlay entry once the server agrees with it, so a pick changed
  // from another tab or device is not shadowed for the life of this one. An
  // entry whose write is still in flight disagrees with the prop it has not
  // landed in yet, so it survives and the selection never flickers back.
  useEffect(() => {
    setPendingPicks((p) => pruneAgreedPicks(p, serverPicks));
  }, [serverPicks]);

  // How this browser likes to look at the week. Deliberately not part of
  // LeagueData: it says nothing about the league, and a profile column would
  // have meant a migration applied to production by hand. The first paint uses
  // the defaults and swaps after hydration — see useStoredChoice.
  //
  // The matchup list is what a new reader meets, and this literal is the only
  // place that is decided: `useStoredChoice` seeds its state with the fallback
  // and reads storage in an effect, so the fallback IS the server paint. Anyone
  // who has already chosen keeps their stored answer — this moves the default
  // and nothing else.
  const [layout, setLayout] = useStoredChoice(PICKS_LAYOUT_KEY, GRID_LAYOUTS, "matchups");

  const labelOpts = { maxPreWeek: practice?.maxPreWeek ?? 0 };
  const viewName = weekLabel(viewRef, labelOpts);
  // The sticky bar's frame abbreviates where the hero spells it out — "WK6"
  // against "Week 6". Both come off the same `viewRef`, so they cannot name
  // different weeks.
  const viewShortName = weekShortName(viewRef, labelOpts);

  /*
    `PickHero`'s root <section>, held in STATE rather than a `useRef` object, and
    that is a correctness requirement rather than a style: stepping between a
    picked week and an unpicked one swaps `PickHero`'s internals for
    `NoPickHero`, which is a different component type at the same position — so
    React replaces the DOM node. A ref object plus a mount-once effect would
    leave the observer watching a detached element forever. A callback ref
    re-runs on every swap, and `setHeroEl` returns undefined, which satisfies
    React 19's ref-cleanup convention.
  */
  const [heroEl, setHeroEl] = useState<HTMLElement | null>(null);

  // Everything below is "whichever phase you're looking at".
  const activeIdx = viewingPractice && practiceIdx ? practiceIdx : idx;
  const liveWeek = viewingPractice && practice ? practice.currentWeek : currentWeek;
  const liveRef = viewingPractice ? PRE_WEEK(liveWeek) : REGULAR_WEEK(liveWeek);
  const liveName = weekLabel(liveRef, labelOpts);
  // sameWeek, not a bare week-number compare: preseason week N is not regular
  // week N, and conflating them let a preview render as though it were live.
  const isCurrent = sameWeek(viewRef, liveRef);
  // The strip carries the whole season, so a week on screen can be behind the
  // live one as well as ahead of it. A bare week compare is safe here:
  // `selectedKey` can only name a week the strip offers, and the strip only
  // offers preseason weeks while `liveRef` is a preseason one, so the two refs
  // always share a `seasonType`.
  const viewingPast = !isCurrent && viewRef.week < liveRef.week;
  const viewingFuture = !isCurrent && viewRef.week > liveRef.week;
  /*
   * Whether this week may be WRITTEN to — the live week and everything after it.
   *
   * Stated as a positive rather than as `!viewingPast`, even though the two are
   * identical today. `viewingPast` leans on an invariant (the two refs share a
   * seasonType) that holds because of the sanitising above; if that ever slipped,
   * a negation would fail OPEN and quietly make an unrelated week writable, where
   * this fails closed. Per-game locks are still the surface's own job —
   * `buildGridCards` refuses a card whose kickoff has passed — so this is a week
   * gate, not a pick gate.
   */
  const writable = isCurrent || viewingFuture;
  // The pick for the week the strip names — not the phase's live week, which
  // left the banner contradicting the schedule underneath it.
  const pickTeam = pickForWeek(viewRef, serverPicks, pendingPicks);

  // What the strip draws inside each chip: the team spent that week, and how it
  // went. Built here rather than in WeekStrip so this stays the only component
  // that knows how server truth and the optimistic overlay combine — and so a
  // pick lights its own chip the instant it's made, before the server answers.
  const pickedByWeek = useMemo(
    () =>
      buildChipPicks({
        options: weekOptions,
        pickFor: (ref) => pickForWeek(ref, serverPicks, pendingPicks),
        // Per CHIP, not per view. `activeIdx` below follows the week you are
        // LOOKING at, and the strip draws both phases at once — so routing on it
        // would resolve every chip of the other phase against the wrong
        // schedule by bare week number and paint confident green and red off
        // the wrong games. That is the same collision the two indexes above
        // exist to prevent, and nothing in the types can catch it.
        gameFor: (ref, teamId) => {
          const index = ref.seasonType === "pre" ? practiceIdx : idx;
          return index?.gameForTeam(ref.week, teamId) ?? null;
        },
        rules: group.rules,
      }),
    [weekOptions, serverPicks, pendingPicks, idx, practiceIdx, group.rules],
  );

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

  // Teams SPENT FOR GOOD in this phase. Practice and the regular season keep
  // separate lists — a team practised in preseason is available again at Week 1 —
  // which the database enforces via
  // unique (group_id, user_id, season_type, team_id).
  //
  // Both branches read every pick rather than resolved history. History only
  // holds picks whose game has produced a result, and an unresolved pick still
  // spends its team; with no scorer running nothing resolves at all, so a
  // history-based list re-offers spent teams and the database rejects the pick
  // with a 23505. Practice has always read `picks` for that reason; the regular
  // branch read `me.history` until picking ahead arrived and had the same bug
  // latent in it, invisible only because no regular game has ever gone final.
  //
  // Three exclusions now.
  //
  // The week on screen is excluded from its own list: your pick there is a
  // selection you may still replace, not a team you have spent. Same exclusion
  // submitPick applies via practiceUsedTeams(me, { excludeWeek }) — without it
  // the team the hero highlights also renders struck through as "Used · Wn".
  //
  // A pick whose game has NOT KICKED OFF is excluded too, because it is a plan
  // rather than a spend: the week you tap wins, so tapping that team here
  // releases the other week and raises a toast naming it. `submitPick` makes the
  // same cut on the same test, and 0001's delete policy carries it as well — so
  // a card this list leaves available is one the database will genuinely accept.
  //
  // And when you are looking BACKWARDS, every week after the one on screen goes
  // too. Without it Week 3 flags a team as "Used · W10" — spent in a week that,
  // from where you are standing, has not been played.
  const usedByTeam = useMemo(() => {
    const spent = (week: number, teamId: TeamId) => {
      if (week === viewRef.week) return false;
      if (viewingPast && week > viewRef.week) return false;
      const game = activeIdx.gameForTeam(week, teamId);
      // No game found means no evidence it is releasable — keep it flagged. A
      // wrongly-flagged team costs a trip to that week; a wrongly-offered one
      // costs a rejected pick with no explanation.
      return game ? isKickedOff(game, now) : true;
    };
    const source = viewingPractice ? (practiceMe?.picks ?? []) : activeEntry.picks;
    const entries: [TeamId, UsedPick][] = source
      .filter((p) => spent(p.week, p.teamId))
      .map((p) => [p.teamId, { week: p.week }]);
    return new Map<TeamId, UsedPick>(entries);
  }, [activeEntry.picks, practiceMe, viewingPractice, viewingPast, viewRef.week, activeIdx, now]);

  // The viewer's picks for the phase on screen, which is what a release is
  // looked up against — `committedWeek` must never answer with a preseason week
  // while the regular season is being picked, or the toast names a week the
  // strip is not showing.
  // The active entry's, so a team spent by entry 1 does not read as spent for
  // entry 2 — the whole point of the two runs being independent.
  const phasePicks = viewingPractice ? (practiceMe?.picks ?? []) : activeEntry.picks;

  // The VIEWED week's fixture. Resolving it against liveWeek instead found that
  // team's game in a completely different week and rendered its opponent,
  // kickoff and countdown as fact — a matchup the member never picked.
  const pickGame = pickTeam ? activeIdx.gameForTeam(viewRef.week, pickTeam) : undefined;

  // Nothing left to count down to once a week's last kickoff has passed;
  // countdown() answers "now" for a past target, so drop the line instead.
  const weekDeadline = activeIdx.weekFinalKickoff(viewRef.week);
  const viewDeadline = weekDeadline && weekDeadline > now ? weekDeadline : null;

  function handleSelect(teamId: TeamId) {
    // A week already played is read-only. Both surfaces already refuse to fire
    // there, but this is the gate that matters on the client — and the server
    // re-checks it in `resolvePickWeek` regardless, because a Server Action is a
    // reachable endpoint and a disabled radio stops nobody.
    if (!writable) return;

    // Keyed to the week ON SCREEN, which is now the week submitPick will write.
    // It used to be `weekKey(liveRef)`, because that was the only writable week.
    const key = selectedKey;
    const queue = queuesRef.current.get(key) ?? IDLE_QUEUE;
    // The revert baseline, read only while the chain is idle: what this tab
    // believes the server holds. Mid-chain the value on screen is the
    // optimistic overlay, which is exactly what a revert must not target —
    // tapPick ignores this argument then and the chain carries its own.
    const serverValue = pickForWeek(viewRef, serverPicks, pendingPicks);
    const { state, submit } = tapPick(queue, teamId, serverValue);
    queuesRef.current.set(key, state);

    /*
     * The release. A team booked for another week of this phase comes off that
     * week — the week you tap wins — so BOTH chips move at once, or the strip
     * briefly shows one team in two places.
     *
     * `usedByTeam` is precisely "spent for good", so a team absent from it and
     * booked elsewhere is one whose other week can be released. Reusing that map
     * rather than re-testing kickoff here is what stops the grid offering a card
     * on one rule while the overlay clears a chip on another. `submitPick` makes
     * the same cut server-side rather than trusting either.
     */
    const release = usedByTeam.has(teamId)
      ? null
      : committedWeek(phasePicks, teamId, viewRef.week);
    const releaseRef =
      release === null ? null : viewingPractice ? PRE_WEEK(release) : REGULAR_WEEK(release);

    setPendingPicks((m) => {
      const next = new Map(m).set(key, teamId); // optimistic, always
      // An explicit null, not a delete: it has to beat a server map that has not
      // been re-fetched yet. `pickForWeek` tests `has` for exactly this.
      if (releaseRef) next.set(weekKey(releaseRef), null);
      return next;
    });
    setPickError(null);
    if (submit !== null) launchPick(key, submit, releaseRef ? weekKey(releaseRef) : null);
  }

  /**
   * Run one link of a week's submit chain. Settling releases the trailing tap
   * (if one arrived mid-flight), which recurses here — so the chain drains
   * itself, one request in flight at a time.
   *
   * `releaseKey` is the OTHER week this tap emptied, if any. It rides along
   * rather than living in the queue because `PickQueue` models one week's
   * value: the chain's `confirmed` is what a revert restores for `key`, and the
   * released week needs its own undo.
   *
   * Note it is the OPTIMISTIC guess, used only to clear a chip and to put it
   * back on failure. The TOAST is raised from the server's `releasedWeek`
   * instead — a confirmation should follow the fact, and the server sees
   * releases this argument cannot: a trailing tap recurses here without one,
   * because `settlePick` knows the team it is sending and nothing about what
   * that team was booked against.
   */
  function launchPick(key: string, teamId: TeamId, releaseKey: string | null = null) {
    // Captured at launch, not read at settle: switching entries mid-request
    // must settle the chain this pick belongs to, not whichever one is on
    // screen when the server answers.
    const entryNo = activeEntryNo;
    const qKey = queueKey(entryNo, key);
    // Both derived from the key itself, so neither can disagree with the week
    // the overlay painted under.
    //
    // Bailing on an unparseable key rather than letting `week` go undefined:
    // `submitPick` reads a missing week as "the live one", so a key that failed
    // to parse would quietly write a DIFFERENT week from the one the overlay
    // just painted. `selectedKey` is always a real key, so this is unreachable —
    // and it is the unreachable branches that fail open when nobody says.
    const ref = parseWeekKey(key);
    if (!ref) return;
    const seasonType = ref.seasonType === "pre" ? "pre" : "regular";
    const week = ref.week;
    startTransition(async () => {
      let ok = false;
      let released: number | null = null;
      let errText = "Couldn't save that pick. Try again.";
      try {
        const res = await submitPick({ groupId: group.id, teamId, seasonType, week, entryNo });
        ok = res.ok;
        if (res.ok) released = res.data?.releasedWeek ?? null;
        else errText = PICK_ERROR[res.error] ?? errText;
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        // The chain is left unsettled on purpose: the reload repaints server
        // truth, and a queued tap dies with the page it belonged to.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
      }
      const outcome = settlePick(queuesRef.current.get(qKey) ?? IDLE_QUEUE, ok);
      queuesRef.current.set(qKey, outcome.state);
      // The overlay, the toast and the error banner all describe the entry on
      // SCREEN. If the player has switched tabs while this was in flight they
      // belong to a view nobody is looking at, and painting them would put one
      // entry's result on the other's card. The chain above is still settled,
      // and the trailing tap below still drains, so nothing is stranded.
      const stillShowing = activeEntryRef.current === entryNo;
      if (outcome.revert && stillShowing) {
        const revertTo = outcome.revert.to;
        setPendingPicks((m) => {
          const next = new Map(m).set(key, revertTo);
          // Put the released week back by DROPPING the overlay entry rather than
          // rewriting the team: the server never accepted the release, so its
          // own map is still right and an explicit value here would shadow it.
          if (releaseKey) next.delete(releaseKey);
          return next;
        });
      }
      // The server is the only thing that knows a release actually landed, so
      // it is the only thing that raises the sentence saying so.
      if (released !== null && stillShowing) {
        const releasedRef = seasonType === "pre" ? PRE_WEEK(released) : REGULAR_WEEK(released);
        const name = getTeam(teamId)?.name ?? "That team";
        setToast((t) => raiseToast(t, releaseMessage(name, weekLabel(releasedRef, labelOpts))));
        // Covers a release this tab did not predict — a trailing tap arrives
        // here with no `releaseKey`, and its chip would otherwise hold the team
        // until the revalidated props landed.
        setPendingPicks((m) => new Map(m).set(weekKey(releasedRef), null));
      }
      if (outcome.surfaceError && stillShowing) setPickError(errText);
      if (outcome.submit !== null) launchPick(key, outcome.submit);
    });
  }

  return (
    /* No `space-y-*` here, and that is the point: PickHero's own `py-10 lg:py-12`
       is the entire gap between the week strip and the module, per the mockup. A
       root `space-y-4` stacked 16px on top of it and made that seam 56/64px.

       So every OTHER block carries its own `mt-4`, which is the same trade
       StandingsClient makes for the same reason — `space-y-*` compiles to
       `> * + *` at a specificity a child's `mt-*` cannot override, so it is
       all-or-nothing rather than something one child can opt out of. */
    <div className="stagger">
      {/* Renders NOTHING for a one-entry player, which is everyone until
          somebody takes a second — so the `.stagger` cascade below is unchanged
          for them, and the 8 `:nth-child` delay rules in globals.css still have
          room (Toast and PickStickyBar portal out, so this subtree paints four
          DOM children, or five with the switcher).

          `pb-6` is the design's own 24px down to the week strip; the strip has
          no top margin of its own, so this owns the seam. */}
      {/* Where the switcher WILL be. Shown only while a second entry is still
          possible, so the row disappears the moment it is taken (the switcher
          replaces it) and once entry closes for the league — `add_entry` refuses
          after `entry_closes_at`, and an affordance that is going to be refused
          is worse than none. `data.phase === "preseason"` IS "entry is open";
          `seasonPhase` derives both from the same timestamp. */}
      {entries.length < 2 && data.phase === "preseason" ? (
        <AddEntryCta
          groupId={group.id}
          buyInCents={group.buyInCents}
          siteFeeCents={group.siteFeeCents}
          className="mb-6"
        />
      ) : null}

      <EntryTabs
        tabs={entries.map((e) => ({
          entryNo: e.entryNo,
          // The team THIS entry holds for the week on screen, which is what
          // makes the card a statement of fact rather than a label. The active
          // entry's card reads through the optimistic overlay so it ticks over
          // with the tap; the other's is server truth, which is all this tab
          // knows about it.
          teamId:
            e.entryNo === activeEntryNo
              ? pickTeam
              : (viewerPicksByWeek({ regularPicks: e.picks }).get(selectedKey) ?? null),
        }))}
        value={activeEntryNo}
        onChange={(entryNo) => {
          setEntryChoice(String(entryNo) as (typeof ENTRY_CHOICES)[number]);
          // One entry's refusal must not hang over the other's card.
          setPickError(null);
        }}
        panelKey="picks-entry"
        className="pb-6"
      />

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

      <PickHero
        ref={setHeroEl}
        weekName={viewName}
        teamId={pickTeam}
        game={pickGame}
        now={now}
        weekFinalKickoff={viewDeadline}
      />

      {pickError ? (
        <div className="mt-4 flex items-start gap-2 rounded-control border border-out/30 bg-out-wash px-3 py-2.5 text-sm text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pickError}</span>
        </div>
      ) : null}

      <div className="mt-4 lg:mt-8">
        {/* sr-only below lg — replaces the visible "Schedule" heading the week
            strip absorbed, so heading-jump navigation still reaches the grid.
            From lg it's revealed beside the filters (Figma's "Select a Team",
            justify-between against the Layout row); mobile has no such
            heading in the mockups, so it stays sr-only there. The row's own
            mb-6/lg:mb-5 is the 24px/20px gap down to whatever follows —
            replaces PickFilters' old flat mb-4. */}
        <div className="mb-6 flex flex-col lg:mb-5 lg:flex-row lg:items-start lg:justify-between">
          <h2 className="sr-only lg:not-sr-only lg:text-[16px] lg:font-semibold lg:uppercase lg:leading-[1.1] lg:text-shell-mute">
            Select a Team
          </h2>

          <PickFilters layout={layout} onLayoutChange={setLayout} />
        </div>

        {viewingPast ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            <span className="font-semibold text-ink-soft">{viewName}</span> has already
            been played — you&apos;re looking back at it. Picks are open for{" "}
            {liveName} and every week after it.
          </p>
        ) : null}

        {viewingFuture ? (
          <p className="mb-2.5 text-xs text-ink-mute">
            Picking ahead for{" "}
            <span className="font-semibold text-ink-soft">{viewName}</span>. It locks
            when your team plays, and you can change it any time until then.
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
            interactive={writable}
            now={now}
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
            interactive={writable}
            now={now}
            onSelect={handleSelect}
          />
        )}
      </div>

      {/* Portals to document.body, so `.stagger > *` cannot claim it — see
          Toast. Rendering it here rather than beside pickError is deliberate:
          the two say different things (one confirms, one refuses) and a failed
          release clears the toast so only the error remains. */}
      <Toast message={toast} onDismiss={() => setToast(null)} />

      {/* Also portalled, and here for a second reason beyond Toast's: `.stagger`
          retains `reveal-up`'s `transform: translateY(0)` on every direct child
          for the life of the page (fill-mode `both`), and a non-`none` transform
          is a containing block for `position: fixed` — so a fixed bar rendered
          anywhere in this subtree would pin to a page block instead of the
          viewport. Its docblock has the full argument.

          NO `key`: remounting would reset `visible` and replay the slide on
          every tap. Same rule as `<PickHero>` above, for a different reason. */}
      <PickStickyBar
        weekName={viewShortName}
        teamId={pickTeam}
        game={pickGame}
        anchor={heroEl}
        // Only handed the tabs when there are two entries; below that the bar is
        // exactly what it always was. Same array the in-flow switcher gets, so
        // the two cannot show different teams for the same entry.
        entryTabs={
          entries.length >= 2
            ? entries.map((e) => ({
                entryNo: e.entryNo,
                teamId:
                  e.entryNo === activeEntryNo
                    ? pickTeam
                    : (viewerPicksByWeek({ regularPicks: e.picks }).get(selectedKey) ?? null),
              }))
            : undefined
        }
        activeEntryNo={activeEntryNo}
        onEntryChange={(entryNo) => {
          setEntryChoice(String(entryNo) as (typeof ENTRY_CHOICES)[number]);
          setPickError(null);
        }}
      />
    </div>
  );
}

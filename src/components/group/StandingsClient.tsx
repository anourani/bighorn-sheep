"use client";

import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LockIcon } from "@/components/icons";
import { StandingsGrid, type RankedMember, type WeekColumn } from "@/components/group/StandingsGrid";
import { LeagueDetails } from "@/components/group/LeagueDetails";
import { LeagueRulesModal } from "@/components/group/LeagueRulesModal";
import { InviteCta } from "@/components/group/InviteCta";
import { Headcount } from "@/components/app/Headcount";
import { buildGameIndex } from "@/lib/league/games";
import { rankMembers, survivorCounts, type HeadcountInput } from "@/lib/league/view";
import { PRE_WEEK, weekShortLabel } from "@/lib/nfl/calendar";
import { countdown } from "@/lib/time";
import type { LeagueData } from "@/lib/league/load";
import type { Member } from "@/lib/league/types";

export function StandingsClient({ data }: { data: LeagueData }) {
  const { group, currentWeek, finalWeek, nowIso, phase, hiddenPickUserIds, practice, practiceEnabled } =
    data;
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const idx = useMemo(() => buildGameIndex(data.games), [data.games]);
  const [rulesOpen, setRulesOpen] = useState(false);

  /*
   * The live week decides the order now, so ranking needs the same game index,
   * rules and clock the grid reads — see `rankMembers`. `hiddenPickUserIds` is
   * not optional in spirit: without it a rival whose pick is locked but not yet
   * revealed reaches the client as nothing at all, and would sort as though
   * they had not picked.
   */
  const ranked = useMemo(
    () =>
      rankMembers(data.members, {
        currentWeek,
        gameForTeam: idx.gameForTeam,
        rules: group.rules,
        now,
        hiddenPickUserIds,
      }),
    [data.members, currentWeek, idx, group.rules, now, hiddenPickUserIds],
  );
  /*
   * Empty string, not "https://bighorn.example" — a domain that does not exist,
   * so the old fallback handed out invite links nobody could open.
   *
   * "" is the expected value outside production, not a failure: the Netlify
   * variable is scoped per deploy context and left blank on previews and branch
   * deploys, so each one hands out its own links instead of production's. Every
   * consumer therefore resolves it as `appUrl || window.location.origin` —
   * `InviteCta` here, `MoreSection` and `AdminSettingsDrawer` on /app/account.
   * Passing it down raw is what made a preview's link a relative path.
   */
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const isPreseason = phase === "preseason";

  const practiceIdx = useMemo(
    () => (practice ? buildGameIndex(practice.games) : null),
    [practice],
  );

  /**
   * What the headcount reads, in the one shape `headcountLine()` takes. The
   * week is `currentWeek`, so the "Week 6" in that heading follows the season
   * without anyone editing it.
   *
   * `now` is the server's `nowIso`, so the pre-season countdown is stamped at
   * render and deliberately does not tick — see the note at load.ts:335-337.
   */
  const headcount = useMemo<HeadcountInput>(() => {
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
   * reused wholesale. Identity comes from the real membership row; strikes and
   * history are the DERIVED preseason values — the real ones are never touched,
   * which is what makes the Week 1 reset free.
   *
   * `status` and `eliminatedWeek` are constants rather than derived values, and
   * `PracticeMember` deliberately carries neither: nothing eliminates in practice,
   * so everyone is alive here every week. `rankMembers` then falls into its alive
   * branch for the whole table and orders on practice losses, which is exactly the
   * ranking this board wants.
   */
  const practiceRanked = useMemo<RankedMember[] | null>(() => {
    if (!practice || !practiceIdx) return null;
    const merged: Member[] = data.members.map((m) => {
      const p = practice.members[m.id];
      return {
        ...m,
        status: "alive",
        eliminatedWeek: null,
        strikes: p?.strikes ?? 0,
        history: p?.history ?? [],
        currentPick: p?.currentPick ?? null,
      };
    });
    // The practice week and the practice game index, never the regular ones.
    // Everyone here is forced alive, so the eliminated tier is inert and the
    // whole table orders on how the current PRACTICE week is going, then on
    // uncapped practice losses.
    return rankMembers(merged, {
      currentWeek: practice.currentWeek,
      gameForTeam: practiceIdx.gameForTeam,
      rules: group.rules,
      now,
      hiddenPickUserIds: practice.hiddenPickUserIds,
    });
  }, [data.members, practice, practiceIdx, group.rules, now]);

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
    /* A fragment, so the two dialogs below can sit OUTSIDE `.stagger`.

       `.stagger > *` applies `animation: reveal-up 0.5s both` with a
       :nth-child delay, and a dialog rendered as a direct child of it inherits
       that on its own `fixed inset-0` root. The settings drawer was the 6th
       rendered child, so opening it held the whole overlay at opacity 0 for
       275ms and then faded it in over 500ms — during which the drawer's own
       320ms slide had already finished, invisibly. The symptom is a quarter
       second of nothing followed by a pop-in with no slide, and the obvious
       response (lengthening the slide) makes it worse.

       Same trap the account page hit and documents at AccountClient.tsx.
       Moving them out changes the first-paint stagger not at all: both render
       null when closed, so neither ever occupied an :nth-child slot on load. */
    <>
      {/* No `space-y-*` here any more. The blocks below carry a rhythm a single
          uniform gap can't express — league header → 24/30px → headcount card,
          then 64/56 to the table and 56/48 to the invite module under it — and
          `space-y-6`'s `> * + *` selector outranks a child's own `mt-*` on
          specificity, so it can't be overridden per child either. `stagger`
          stays: it keys the entrance animation off direct children, and the
          count below is unchanged.

          Every one of those is a box-to-box measurement off the page mock-ups
          (`4082:139343` desktop, `4158:150123` mobile), and they are box-to-box
          rather than ink-to-ink because the headcount is a filled card now and
          owns padding on both of its seams. */}
      <div className="stagger">
        <LeagueDetails
          group={group}
          memberCount={data.members.length}
          appUrl={appUrl}
          now={now}
          onOpenRules={() => setRulesOpen(true)}
        />

        {/* 24px below the league header on a phone, 30 from `lg`, both measured
            between the two boxes. The card carries its own padding now, so this
            is the whole seam — there is no `py-*` here any more, and passing
            `px-*` would land inside the fill rather than around it. */}
        <Headcount headcount={headcount} className="mt-6 lg:mt-[30px]" />

        {isPreseason ? (
          practice && practiceRanked && practiceColumns && practiceIdx ? (
            <section className="mt-16 lg:mt-14">
              {/* sr-only, not absent. The redesign drops the visible heading
                  above both tables, but a `<section>` with no heading at all
                  falls out of the page's outline and heading-jump navigation
                  stops reaching the table. Same trade `MyPicksClient` makes for
                  the pick grid, where the week strip absorbed the visible one. */}
              <h2 className="sr-only">Practice Standings</h2>
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
          ) : (
            /*
             * Without this the page has a hole in it. The branch renders the
             * practice table during preseason and the real standings after it, so
             * a null `practice` mid-preseason used to emit NOTHING between the
             * headcount and the foot of the page — no heading, no explanation.
             *
             * Two quite different causes land here, which is why `practiceEnabled`
             * exists as its own flag rather than being inferred from the null.
             */
            <section className="mt-16 lg:mt-14">
              <SectionHeader title="Practice Standings" />
              <p className="mb-4 mt-2 text-xs leading-relaxed text-ink-mute">
                {practiceEnabled
                  ? "No preseason schedule has been loaded yet, so there's nothing to practise against."
                  : "Preseason practice isn't switched on for you. Your league admin can turn it on from Settings."}
              </p>
            </section>
          )
        ) : (
          <section className="mt-16 lg:mt-14">
            {/* See the practice branch above: heading kept for the outline,
                hidden visually. The `mt-3` wrapper went with the visible
                heading — it was the gap underneath it and had nothing left to
                space away from. */}
            <h2 className="sr-only">Standings</h2>
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

            <p className="mt-2 flex items-center justify-center gap-1.5 px-2 text-center text-xs text-ink-mute">
              <LockIcon className="h-3.5 w-3.5" />
              Current-week picks stay hidden until each team&apos;s game kicks off.
            </p>
          </section>
        )}

        {/* Wrapped rather than given a `className` prop: `InviteCta` takes none,
            and the seam belongs to the page rather than to the block.

            56px on a phone, 48 from `lg`. Desktop is unchanged, and it still
            matches the headcount's own step down to the table above — both
            are 48 at that width, so the seam below the table is not the only
            wide one there. Below `lg` the two diverge instead: the status
            report's own step down to the table dropped to 16 in this same pass,
            while this one grew to 56 — a reversal, since 24 used to be the
            tighter of this seam's own two values (24 against a desktop 48) and
            56 is now the wider one (56 against the same 48). That traces back to
            Figma, where this is not a gap between the table and the module at
            all — the Grow-the-League Module's own node carries `pt-[56px]`
            directly, with zero space of its own above it in the frame. The
            wrapper here keeps owning the number anyway, for the same reason
            this is wrapped rather than passed as a prop in the first place: the
            seam belongs to the page, not to `InviteCta`, so the 56 lives on
            this `mt-*` rather than moving onto the component's own root. It is
            now the second-widest gap on the page below `lg`, behind only the
            headcount's own 64px lead-in, and reads less like the page
            tapering off and more like the invite module being marked out as
            its own distinct final block.

            The roster ("Who's In") used to sit between the table and this, on
            the same seam. It was removed rather than hidden: every fact in it —
            who is in the league, who is alive, who the commissioner is — is
            already on the standings grid above or in the admin drawer. The
            headcount beside the invite heading is not a partial restoration of
            it: `LeagueDetails` prints "N in" and the headcount "N joined"
            on this same screen, both from this same `members.length`, so during
            preseason the number is on the page three times. That is the
            design's call, not an oversight to tidy up.

            Rendered conditionally rather than always: `InviteCta` returns null
            once entry closes, and a wrapper around null is still an empty div
            carrying 56/48px of margin at the foot of the page. `isPreseason` is
            the same predicate as the component's own `isEntryOpen` guard (both
            read `entryClosesAt` against the server `now`), which stays — a
            Server Action's surface is not gated by its call site. Dropping the
            block also leaves `.stagger` with three children instead of four,
            which changes no delay: the missing one was invisible anyway. */}
        {isPreseason ? (
          <div className="mt-14 lg:mt-12">
            <InviteCta
              group={group}
              memberCount={data.members.length}
              appUrl={appUrl}
              now={now}
            />
          </div>
        ) : null}

      </div>

      <LeagueRulesModal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        group={group}
        members={data.members}
      />
    </>
  );
}

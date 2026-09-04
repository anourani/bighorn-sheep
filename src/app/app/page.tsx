import { loadLeague, viewerTourCompleted } from "@/lib/league/load";
import { MyPicksClient } from "@/components/picks/MyPicksClient";
import { NoLeagueState } from "@/components/app/NoLeagueState";
import { JoinOutcome } from "@/components/app/JoinOutcome";
import { FirstRunTour } from "@/components/onboarding/FirstRunTour";
import { normalizeInviteCode } from "@/lib/league/join";

/**
 * My Picks (home). Server Component: it loads the viewer's league (RLS-scoped to
 * them) and hands the serialized data to the client screen. A player in no
 * league yet gets the join-by-code prompt — there is no create-a-league path.
 *
 * No `Headcount` here, unlike Standings. This screen opens on the week
 * strip: the week you are picking for is the one fact the page is about, and a
 * band restating it above the fold only pushed the pick itself down. The
 * countdown and the joined/survivor tally still live one tab away.
 *
 * It is also where the two invite paths that skip the login screen come out —
 * see `JoinOutcome`. This route rather than /app/standings because /app is
 * where both of them are sent: middleware redirects a signed-in visitor off
 * /login to here, and the auth callback's `next` defaults to here too.
 */
export default async function MyPicksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // Same guard middleware applies before putting the code in the URL. Applied
  // again here because a Server Component may not assume how it was reached.
  const invite = normalizeInviteCode(
    typeof params.invite === "string" ? params.invite : null,
  );
  const notice = typeof params.notice === "string" ? params.notice : null;

  const load = await loadLeague();

  // Only for someone who is actually in a league — see the tour's placement
  // below. Read unconditionally so the two awaits are not serialised behind a
  // branch; it is one indexed read and `cache()`d.
  const tourCompleted = await viewerTourCompleted();

  // The banner sits OUTSIDE the page root, never inside it: both roots below
  // carry `.stagger`, whose `> *` rule applies a reveal animation and an
  // :nth-child delay to every direct child — a banner in there would fade in
  // late, and would shift every sibling's delay by one.
  //
  // The tour is here for a harder version of the same reason. It is a
  // `position: fixed` dialog that does not portal, and `.stagger`'s reveal
  // leaves a transform applied for the life of the page — which makes that root
  // a containing block for fixed descendants, so a tour rendered anywhere
  // inside `MyPicksClient` would be pinned to a page block rather than the
  // viewport. `PickStickyBar` carries the long version of this note.
  //
  // It is inside the league branch rather than beside it: a player with no
  // league has nothing to be toured around, and the first card would be
  // pointing at tabs they cannot use.
  return (
    <>
      <JoinOutcome invite={invite} notice={notice} />
      {load.kind !== "ok" ? (
        <NoLeagueState />
      ) : (
        <>
          <MyPicksClient data={load.data} />
          <FirstRunTour completed={tourCompleted} />
        </>
      )}
    </>
  );
}

import { loadLeague } from "@/lib/league/load";
import { MyPicksClient } from "@/components/picks/MyPicksClient";
import { LeagueStatusBar } from "@/components/app/LeagueStatusBar";
import { NoLeagueState } from "@/components/app/NoLeagueState";

/**
 * My Picks (home). Server Component: it loads the viewer's league (RLS-scoped to
 * them) and hands the serialized data to the client screen. A player in no
 * league yet gets the create/join onboarding.
 */
export default async function MyPicksPage() {
  const load = await loadLeague();
  if (load.kind !== "ok") return <NoLeagueState />;
  // Sibling of the client root, never a child: inside `.stagger` it would shift
  // every existing delay by 55ms and give the bar an entrance it shouldn't have.
  return (
    <>
      <LeagueStatusBar />
      <MyPicksClient data={load.data} />
    </>
  );
}

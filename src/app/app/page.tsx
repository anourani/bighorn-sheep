import { loadLeague } from "@/lib/league/load";
import { MyPicksClient } from "@/components/picks/MyPicksClient";
import { NoLeagueState } from "@/components/app/NoLeagueState";

/**
 * My Picks (home). Server Component: it loads the viewer's league (RLS-scoped to
 * them) and hands the serialized data to the client screen. A player in no
 * league yet gets the create/join onboarding.
 */
export default async function MyPicksPage() {
  const load = await loadLeague();
  if (load.kind !== "ok") return <NoLeagueState />;
  return <MyPicksClient data={load.data} />;
}

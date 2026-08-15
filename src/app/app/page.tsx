import { loadLeague } from "@/lib/league/load";
import { MyPicksClient } from "@/components/picks/MyPicksClient";
import { NoLeagueState } from "@/components/app/NoLeagueState";

/**
 * My Picks (home). Server Component: it loads the viewer's league (RLS-scoped to
 * them) and hands the serialized data to the client screen. A player in no
 * league yet gets the create/join onboarding.
 *
 * No `LeagueStatusBar` here, unlike Standings. This screen opens on the week
 * picker: the week you are picking for is the one fact the page is about, and
 * the bar restated it above the fold while pushing the pick itself down. The
 * countdown and the joined/survivor tally still live one tab away.
 */
export default async function MyPicksPage() {
  const load = await loadLeague();
  if (load.kind !== "ok") return <NoLeagueState />;
  return <MyPicksClient data={load.data} />;
}

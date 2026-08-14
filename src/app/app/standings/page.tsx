import { loadLeague } from "@/lib/league/load";
import { StandingsClient } from "@/components/group/StandingsClient";
import { LeagueStatusBar } from "@/components/app/LeagueStatusBar";
import { NoLeagueState } from "@/components/app/NoLeagueState";

/**
 * Standings. Server Component: loads the viewer's league (RLS-scoped) and, in
 * season, the team-less hidden-pick flags that keep the padlock working. A
 * player in no league yet gets the create/join onboarding.
 */
export default async function StandingsPage() {
  const load = await loadLeague();
  if (load.kind !== "ok") return <NoLeagueState />;
  // Sibling of the client root — see the note in src/app/app/page.tsx.
  return (
    <>
      <LeagueStatusBar />
      <StandingsClient data={load.data} />
    </>
  );
}

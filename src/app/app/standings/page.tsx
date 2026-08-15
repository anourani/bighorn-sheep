import { loadLeague } from "@/lib/league/load";
import { StandingsClient } from "@/components/group/StandingsClient";
import { NoLeagueState } from "@/components/app/NoLeagueState";

/**
 * Standings. Server Component: loads the viewer's league (RLS-scoped) and, in
 * season, the team-less hidden-pick flags that keep the padlock working. A
 * player in no league yet gets the create/join onboarding.
 *
 * The week and survivor tally that once sat above the client root, in a
 * full-bleed `LeagueStatusBar`, are now a `StatusReport` section inside it —
 * below the league summary, per the mockup.
 */
export default async function StandingsPage() {
  const load = await loadLeague();
  if (load.kind !== "ok") return <NoLeagueState />;
  return <StandingsClient data={load.data} />;
}

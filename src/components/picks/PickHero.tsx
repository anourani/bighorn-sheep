import { LocalTime } from "@/components/ui/LocalTime";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { isHome, opponentOf } from "@/lib/league/view";

/**
 * The My Picks hero: an unapologetically fan-first banner for the team you
 * picked. The card is washed in the team's primary color (a faint tint up top
 * deepening to near-solid at the bottom) with the team's logo ghosted behind
 * the name — so opening the app *feels* like the team you're riding with.
 */
export function PickHero({
  teamId,
  game,
  week,
  now,
  weekFinalKickoff,
}: {
  teamId: TeamId | null;
  game: Game | undefined;
  week: number;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  if (!teamId || !game) {
    return <NoPickHero week={week} now={now} weekFinalKickoff={weekFinalKickoff} />;
  }

  const team = getTeam(teamId)!;
  const opp = getTeam(opponentOf(game, teamId));
  const home = isHome(game, teamId);
  const kicked = isKickedOff(game, now);
  const cd = countdown(new Date(game.kickoff), now);
  const [r, g, b] = hexToRgb(team.color);

  return (
    <section className="border-b border-line pb-4">
      <div
        className="relative isolate flex min-h-[180px] flex-col items-center justify-center overflow-hidden rounded-card px-4 py-4 text-center"
        style={{
          backgroundColor: "#fff",
          backgroundImage: `linear-gradient(180deg, rgba(${r},${g},${b},0.05) 0%, rgba(${r},${g},${b},0.8) 100%)`,
        }}
      >
        {/* Team logo, ghosted into the background. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat opacity-20 md:left-[72px] md:translate-x-0"
          style={{ backgroundImage: `url(https://a.espncdn.com/i/teamlogos/nfl/500/${teamId}.png)` }}
        />

        <span className="relative z-10 font-sans text-[15px] font-bold uppercase leading-[1.4] tracking-[0.04em] text-[#757575] sm:text-base">
          Your Pick · Week {week}
        </span>

        <h1 className="relative z-10 mt-2 max-w-full break-words px-2 font-sans font-bold leading-[0.9] tracking-tight text-[#1E1E1E] text-[clamp(2.5rem,12vw,5rem)]">
          {team.name}
        </h1>

        <div className="relative z-10 mt-4 flex flex-col items-center gap-1">
          <p className="text-[15px] font-semibold leading-[1.2] text-[#1E1E1E] sm:text-base">
            {home ? "Home Game" : "Away Game"}
            <span className="text-[#1E1E1E]/60">
              {" · "}
              {home ? "vs" : "@"} {opp?.name ?? "TBD"}
            </span>
          </p>
          <LocalTime iso={game.kickoff} mode="full" className="text-xs font-medium text-[#1E1E1E]/80" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-xs font-medium text-ink-mute">
        {kicked ? (
          <span>This game has kicked off — your pick is now visible to the group.</span>
        ) : (
          <>
            <span>Locks in {cd.label}</span>
            <span>Only you can see this pick until the game kicks off.</span>
          </>
        )}
      </div>
    </section>
  );
}

function NoPickHero({
  week,
  now,
  weekFinalKickoff,
}: {
  week: number;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  const cd = weekFinalKickoff ? countdown(weekFinalKickoff, now) : null;
  return (
    <section className="border-b border-line pb-4">
      <div
        className="relative flex min-h-[180px] flex-col items-center justify-center overflow-hidden rounded-card px-4 py-4 text-center"
        style={{
          backgroundColor: "#fff",
          backgroundImage: "linear-gradient(180deg, rgba(83,97,122,0.05) 0%, rgba(83,97,122,0.32) 100%)",
        }}
      >
        <span className="font-sans text-[15px] font-bold uppercase tracking-[0.04em] text-[#757575] sm:text-base">
          Your Pick · Week {week}
        </span>
        <h1 className="mt-2 font-sans font-bold leading-[0.9] tracking-tight text-[#1E1E1E] text-[clamp(2rem,9vw,3.5rem)]">
          No pick yet
        </h1>
        <p className="mt-4 text-sm font-medium text-[#1E1E1E]/80">
          Choose your team from the schedule below.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-xs font-medium text-ink-mute">
        {cd ? <span>Week locks in {cd.label}</span> : null}
        <span>Miss the final kickoff and it counts as a loss.</span>
      </div>
    </section>
  );
}

/** "#RRGGBB" (or "#RGB") → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

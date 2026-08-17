import { Label } from "@/components/ui/Label";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { isHome, opponentOf } from "@/lib/league/view";
import { stripGradient } from "./pick-hero";

/**
 * The My Picks hero: who you are riding with this week.
 *
 * The team's colour lives in three vertical strips behind its logo, and nothing
 * else on the module is coloured — eyebrow, name, matchup and lock copy are all
 * ordinary page text. That is the whole design, and it is why this file is no
 * longer 250 lines: the predecessor washed the entire module in the team colour,
 * so every string sat *on* that wash and the component had to compute per-team
 * gradient endpoints and flip its text between ink and white to clear WCAG AA at
 * the card's worst point. Decoration nothing has to be legible on top of needs
 * none of that.
 *
 * Two invariants worth keeping:
 *
 *  - **The module is the same height for every team.** The row is a fixed
 *    height, the strips are `h-full` of it, and the name is size-clamped rather
 *    than wrapped. A previous version's height varied with the pick, so the page
 *    grew and shrank as you moved along the week strip; here that is structural
 *    rather than a thing to remember.
 *  - **Nothing in the tree may take `overflow-hidden`.** From `lg` the logo is
 *    pinned left-of-centre inside the strips and deliberately overhangs them to
 *    the right, into the gap before the team name.
 */
export function PickHero({
  teamId,
  game,
  weekName,
  practice = false,
  now,
  weekFinalKickoff,
}: {
  teamId: TeamId | null;
  game: Game | undefined;
  /** Formatted week label — "Week 5", "Preseason 2", "Hall of Fame". */
  weekName: string;
  /** True when this is a practice (preseason) pick, which resets at Week 1. */
  practice?: boolean;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  if (!teamId || !game) {
    return (
      <NoPickHero
        weekName={weekName}
        practice={practice}
        now={now}
        weekFinalKickoff={weekFinalKickoff}
      />
    );
  }

  const team = getTeam(teamId);
  if (!team) {
    return (
      <NoPickHero
        weekName={weekName}
        practice={practice}
        now={now}
        weekFinalKickoff={weekFinalKickoff}
      />
    );
  }
  const opp = getTeam(opponentOf(game, teamId));
  const home = isHome(game, teamId);
  const kicked = isKickedOff(game, now);
  const cd = countdown(new Date(game.kickoff), now);

  return (
    <Shell weekName={weekName}>
      <PickRow>
        <Strips>
          {/* The one place the team's colour appears. `down`/`up`/`down` so the
              three read as one object catching light, not three copies of a bar. */}
          <Strip gradient={stripGradient(team.color, "down")} />
          <Strip gradient={stripGradient(team.color, "up")} />
          <Strip gradient={stripGradient(team.color, "down")} />

          {/* Centred over the strips on a phone, offset right of them from `lg`
              — where it is big enough to overhang into the gap before the name.
              `aria-hidden` because the <h1> already names the team, and the two
              sizes are separate elements because TeamLogo sets width/height
              inline, which no responsive class can reach. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 lg:left-[18px] lg:translate-x-0"
          >
            <TeamLogo teamId={teamId} size={50} className="lg:hidden" />
            <TeamLogo teamId={teamId} size={80} className="hidden lg:block" />
          </span>
        </Strips>

        <Identity>
          <Name city={team.location}>{team.name}</Name>
          <Rule />
          <Meta>
            <span>
              {home ? "vs." : "@"} {opp?.name ?? "TBD"}
            </span>
            <MetaDivider />
            <LocalTime iso={game.kickoff} mode="date" />
            <MetaDivider />
            <LocalTime iso={game.kickoff} mode="clockzone" />
          </Meta>
        </Identity>
      </PickRow>

      <LockColumn>
        {kicked ? (
          <p className="text-shell-ink">
            This game has kicked off — your pick is now visible to the group.
          </p>
        ) : (
          <>
            <p className="text-shell-ink">Locks in {cd.label}</p>
            <p className="text-shell-mute">
              Only you can see this pick until the game kicks off
            </p>
          </>
        )}
        {practice ? (
          <p className="text-shell-mute">Practice only — everyone resets for Week 1.</p>
        ) : null}
      </LockColumn>
    </Shell>
  );
}

/**
 * The same module with nothing picked. It keeps the filled state's skeleton
 * exactly — including invisible stand-ins for the city and matchup lines — so
 * the headline's baseline does not move as you step between a picked week and an
 * unpicked one.
 */
function NoPickHero({
  weekName,
  practice,
  now,
  weekFinalKickoff,
}: {
  weekName: string;
  practice: boolean;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  const cd = weekFinalKickoff ? countdown(weekFinalKickoff, now) : null;

  return (
    <Shell weekName={weekName}>
      <PickRow>
        <Strips>
          {/* Inert: no gradient, no logo. The strips are still here because
              their absence would move the headline. */}
          <Strip />
          <Strip />
          <Strip />
        </Strips>

        <Identity>
          <Name>No Pick Made</Name>
          {/* No <Rule/> here: from `lg` it would be a hairline dividing the
              headline from empty space. The matchup below is `invisible` rather
              than absent because it holds that line's height, and so the
              headline lands where a team name's does — but the rule has nothing
              to separate, and a rule with nothing beside it reads as a mistake. */}
          <Meta className="invisible">&nbsp;</Meta>
        </Identity>
      </PickRow>

      <LockColumn>
        {cd ? <p className="text-shell-ink">Week locks in {cd.label}</p> : null}
        <p className="text-shell-mute">Miss the final kickoff and it counts as a loss.</p>
        {practice ? (
          <p className="text-shell-mute">Practice only — everyone resets for Week 1.</p>
        ) : null}
      </LockColumn>
    </Shell>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────
//
// Split into named pieces because the two states share every one of them, and a
// second copy of this markup is exactly how the empty state drifts out of
// alignment with the filled one.
//
// The breakpoint throughout is `lg`, not `md`: the desktop row needs ~986px to
// hold an 80px headline beside a 168px lock column, and the shell is
// `max-w-shell` (1000px) inside a `px-4` gutter. It is also where WeekStrip and
// StandingsGrid change shape, so the page turns over at one width.

/** Outer frame: the eyebrow, and the row/lock split below it. */
function Shell({ weekName, children }: { weekName: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 py-8 lg:border-b lg:border-shell-line">
      <Label className="lg:text-base lg:leading-[1.1]">Your {weekName} Pick</Label>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {children}
      </div>
    </section>
  );
}

/** Strips, logo and text. Its fixed height is what sizes the strips. */
function PickRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[92px] items-center gap-2 lg:h-[132px] lg:gap-[50px]">{children}</div>
  );
}

function Strips({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex h-full shrink-0 items-center gap-1">{children}</div>
  );
}

/** One strip. No gradient means the empty state's inert grey. */
function Strip({ gradient }: { gradient?: string }) {
  return (
    <span
      className={cn("h-full w-4 rounded-[4px] lg:w-5", !gradient && "bg-shell-dark")}
      style={gradient ? { backgroundImage: gradient } : undefined}
    />
  );
}

/** City + name, the rule, and the matchup — stacked on a phone, a row from `lg`. */
function Identity({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center lg:h-full lg:flex-row lg:items-center lg:gap-4">
      {children}
    </div>
  );
}

/**
 * The headline, sized to stay on one line at every width.
 *
 * `(100vw - 96px)` is the room the name actually has: the page's 32px gutter,
 * the 56px strip group and the 8px beside it. Dividing by `6.75` — a
 * deliberately generous em-width for the longest names in the league
 * ("Commanders", "Buccaneers") in Inter SemiBold — lands on exactly the design's
 * 44px at a 393px phone and shrinks below that rather than overflowing. Tracking
 * is in `em` so it stays proportional as the clamp bites.
 */
function Name({ city, children }: { city?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center pt-2 lg:py-5">
      {city ? (
        <Label>{city}</Label>
      ) : (
        // Holds the line the city would occupy, so "No Pick Made" sits where a
        // team name does.
        <Label className="invisible">&nbsp;</Label>
      )}
      <h1 className="max-w-full font-semibold leading-none tracking-[-0.04em] text-shell-ink text-[clamp(1.5rem,calc((100vw_-_96px)/6.75),2.75rem)] lg:tracking-[-0.025em] lg:text-[5rem]">
        {children}
      </h1>
    </div>
  );
}

/** The vertical hairline between the name and the matchup. Desktop only. */
function Rule() {
  return <div className="hidden h-full w-px shrink-0 bg-shell-line lg:block" />;
}

/** Matchup, date and kickoff — one line on a phone, three from `lg`. */
function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 py-1 text-xs font-medium leading-[1.4] text-shell-ink lg:h-full lg:flex-col lg:items-start lg:justify-center lg:gap-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Separates the matchup's three parts on a phone; from `lg` they stack instead. */
function MetaDivider() {
  return <span className="h-5 w-px shrink-0 bg-shell-line lg:hidden" />;
}

/** Lock and privacy copy: under a rule on a phone, a right-hand column from `lg`. */
function LockColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-shell-line pt-2 text-xs font-medium leading-[1.4] lg:w-[168px] lg:shrink-0 lg:border-t-0 lg:pt-0">
      {children}
    </div>
  );
}

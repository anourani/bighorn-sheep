import { LocalTime } from "@/components/ui/LocalTime";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { isHome, opponentOf } from "@/lib/league/view";

/**
 * The My Picks hero: an unapologetically fan-first banner for the team you
 * picked. The card is washed in the team's primary color with the team logo
 * ghosted behind the name — so opening the app *feels* like the team you ride
 * with.
 *
 * Text color is chosen per team so it always clears WCAG AA (4.5:1), and every
 * bit of text *on the card* stays on one side of light/dark (never a mix):
 *  - Bright teams keep dark text on a light→saturated gradient; the gradient's
 *    bottom is capped at the darkest tint where dark text still passes.
 *  - Dark teams flip to white text on a deep team-color card; the top is
 *    darkened until white passes.
 *
 * The lock line underneath is page text, not card text, and stays put in both
 * cases — see the comment at its render site for why it is not a branch.
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
  const theme = heroTheme(team.color);

  const lockLine = kicked
    ? [<span key="k">This game has kicked off — your pick is now visible to the group.</span>]
    : [
        <span key="l">Locks in {cd.label}</span>,
        <span key="p">Only you can see this pick until the game kicks off.</span>,
      ];
  if (practice) {
    lockLine.push(<span key="pr">Practice only — everyone resets for Week 1.</span>);
  }

  return (
    <section className="border-b border-line pb-4">
      <div
        className="relative isolate flex min-h-[180px] flex-col items-center justify-center overflow-hidden rounded-card px-4 py-5 text-center"
        style={{ backgroundColor: "#fff", backgroundImage: theme.gradient }}
      >
        {/* Team logo, ghosted into the background. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat opacity-20 md:left-[72px] md:translate-x-0"
          style={{ backgroundImage: `url(https://a.espncdn.com/i/teamlogos/nfl/500/${teamId}.png)` }}
        />

        <span
          className="relative z-10 font-sans text-[15px] font-bold uppercase leading-[1.4] tracking-[0.04em] sm:text-base"
          style={{ color: theme.label }}
        >
          {practice ? "Practice Pick" : "Your Pick"} · {weekName}
        </span>

        <h1
          className="relative z-10 mt-2 max-w-full break-words px-2 font-sans font-bold leading-[0.9] tracking-tight text-[clamp(2.5rem,12vw,5rem)]"
          style={{ color: theme.text }}
        >
          {team.name}
        </h1>

        <div className="relative z-10 mt-4 flex flex-col items-center gap-1" style={{ color: theme.text }}>
          <p className="text-[15px] font-semibold leading-[1.2] sm:text-base">
            {home ? "Home Game" : "Away Game"} · {home ? "vs" : "@"} {opp?.name ?? "TBD"}
          </p>
          <LocalTime iso={game.kickoff} mode="full" className="text-xs font-medium" />
        </div>
      </div>

      {/* Below the card always, whatever the team's colors — and deliberately
          not a branch. Placement used to follow the theme: dark cards pulled the
          line inside so it could be white, bright ones left it out here. That
          made the colored block's height a function of which team you picked, so
          it grew and shrank as you moved down the schedule. A card that holds
          still is worth more than a lock line that is uniformly white.

          It matches NoPickHero, which has always kept the line outside. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-xs font-medium text-ink-mute">
        {lockLine}
      </div>
    </section>
  );
}

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
    <section className="border-b border-line pb-4">
      <div
        className="relative flex min-h-[180px] flex-col items-center justify-center overflow-hidden rounded-card px-4 py-5 text-center"
        style={{
          backgroundColor: "#fff",
          backgroundImage: "linear-gradient(180deg, rgba(83,97,122,0.05) 0%, rgba(83,97,122,0.3) 100%)",
        }}
      >
        <span className="font-sans text-[15px] font-bold uppercase tracking-[0.04em] text-[#4B5563] sm:text-base">
          {practice ? "Practice Pick" : "Your Pick"} · {weekName}
        </span>
        <h1 className="mt-2 font-sans font-bold leading-[0.9] tracking-tight text-[#1E1E1E] text-[clamp(2rem,9vw,3.5rem)]">
          No pick yet
        </h1>
        <p className="mt-4 text-sm font-medium text-[#1E1E1E]">
          Choose your team from the schedule below.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-xs font-medium text-ink-mute">
        {cd ? <span>Week locks in {cd.label}</span> : null}
        <span>Miss the final kickoff and it counts as a loss.</span>
        {practice ? <span>Practice only — everyone resets for Week 1.</span> : null}
      </div>
    </section>
  );
}

// ── Team-colored, AA-safe theming ────────────────────────────────────────────

const INK = "#1E1E1E";
const WHITE = "#FFFFFF";
const LABEL_DARK = "#4B5563"; // muted eyebrow that still clears AA on the near-white top
const INK_LUM = relLuminance(30, 30, 30);

// No `light` flag here any more. It said "the card is dark and the text is
// white" — inverted enough to misread on sight — and its only consumer was the
// lock line's placement, which no longer branches. The gradient and the two
// colors already carry the outcome of the choice below.
interface HeroTheme {
  gradient: string;
  text: string;
  label: string;
}

/**
 * Pick a text treatment that clears AA (4.5:1) across the whole card. Capping
 * one gradient endpoint guarantees the chosen color passes at the worst point
 * (and therefore everywhere), independent of where each line of text sits.
 */
function heroTheme(hex: string): HeroTheme {
  const rgb = hexToRgb(hex);

  // Darkest tint (≤ 0.80) at which dark ink still clears AA against white base.
  let darkBottom = 0;
  for (let a = 80; a >= 30; a--) {
    if (contrast(INK_LUM, tintLuminance(rgb, a / 100)) >= 4.5) {
      darkBottom = a / 100;
      break;
    }
  }

  // A team bright enough to carry a punchy dark-text wash keeps the light look.
  if (darkBottom >= 0.6) {
    return {
      gradient: gradient(rgb, 0.05, darkBottom),
      text: INK,
      label: LABEL_DARK,
    };
  }

  // Otherwise go dark: deepen the top until white clears AA, so white passes
  // across the whole card (the bottom is darker still).
  let lightTop = 1;
  for (let a = 72; a <= 100; a++) {
    if (contrast(1, tintLuminance(rgb, a / 100)) >= 4.5) {
      lightTop = a / 100;
      break;
    }
  }
  return {
    gradient: gradient(rgb, lightTop, 1),
    text: WHITE,
    label: WHITE,
  };
}

function gradient([r, g, b]: [number, number, number], top: number, bottom: number): string {
  return `linear-gradient(180deg, rgba(${r},${g},${b},${top}) 0%, rgba(${r},${g},${b},${bottom}) 100%)`;
}

/** "#RRGGBB" (or "#RGB") → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance of the team color at `alpha` composited over white. */
function tintLuminance([r, g, b]: [number, number, number], alpha: number): number {
  const mix = (c: number) => alpha * c + (1 - alpha) * 255;
  return relLuminance(mix(r), mix(g), mix(b));
}

function relLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

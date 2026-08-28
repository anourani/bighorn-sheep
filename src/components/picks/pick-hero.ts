/**
 * Pure helpers shared by the My Picks hero and the sticky bar that condenses it,
 * kept out of both components so they unit-test — the same split as
 * `week-strip.ts` / `WeekStrip.tsx` next door. Vitest runs in the Node
 * environment here; there is no jsdom and no @testing-library, so a pure module
 * is the only testable shape.
 *
 * The value imports below are RELATIVE, not `@/`. There is no `vitest.config.ts`
 * in this repo, so vitest never reads tsconfig's `paths` — `@/` survives in the
 * modules around here only where it is an `import type`, which esbuild erases.
 * A `@/` value import would resolve under Next and fail under vitest.
 */
import { getTeam } from "../../lib/nfl/teams";
import { isHome, opponentOf } from "../../lib/league/view";
import type { Game, Team, TeamId } from "../../lib/nfl/types";

/** The ramp's two alphas, from the design. */
const LIGHT = 0.25;
const DEEP = 0.8;

/**
 * The team-colour ramp painted behind a pick — one call per strip.
 *
 * Deliberately a single-hue ALPHA ramp and not a two-colour blend: `teams.ts`
 * carries exactly one brand hex per franchise, so a second stop would have to be
 * invented for all 32. The three strips alternate `down` / `up` / `down` so they
 * read as one object catching light rather than as three copies of one bar.
 *
 * Nothing is painted underneath. The predecessor of this ramp washed the whole
 * module and sat on a hard `#fff` because a WCAG calculation had to know the
 * exact composite; no text sits on these strips, so they composite straight onto
 * the page (`bg`, #FDFDFD) and that 2/255 difference does not earn a
 * declaration.
 */
export function stripGradient(hex: string, direction: "down" | "up"): string {
  const [r, g, b] = hexToRgb(hex);
  const [top, bottom] = direction === "down" ? [LIGHT, DEEP] : [DEEP, LIGHT];
  return `linear-gradient(180deg, rgba(${r},${g},${b},${top}) 0%, rgba(${r},${g},${b},${bottom}) 100%)`;
}

/** "#RRGGBB" (or "#RGB") → [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The eyebrow both pick modules print — "Your Week 6 Pick", "Your WK6 Pick". */
export function eyebrowFor(weekName: string): string {
  return `Your ${weekName} Pick`;
}

/**
 * The opponent line — "vs. Chargers" (short) or "vs. LAC Chargers" (long).
 *
 * NOT `team-grid.ts`'s `matchupLabel`, which prints "Home vs. Ravens" for a
 * card's accessible name. Different string, different surface; named apart so
 * nobody imports the wrong one by autocomplete.
 *
 * The hero takes `short` and the sticky bar `long`, because the bar's frame
 * draws the wider form. `abbr + name` and not `location + name` for that wider
 * form: it is already how the team cards on this same page read ("CIN Bengals"),
 * and "vs. Los Angeles Chargers" measures ~158px against the ~167px the matchup
 * column has at a 360px viewport — it would overflow before reaching a 320px
 * phone.
 *
 * `TBD` rather than `getTeam(...)!`: `games.home`/`away` are bare text with no
 * foreign key, so a bad row can carry a code that is not one of the 32.
 */
export function matchupLine(game: Game, teamId: TeamId, form: "short" | "long"): string {
  const opp = getTeam(opponentOf(game, teamId));
  const who = opp ? (form === "long" ? `${opp.abbr} ${opp.name}` : opp.name) : "TBD";
  return `${isHome(game, teamId) ? "vs." : "@"} ${who}`;
}

/**
 * The one definition of "there is a pick to draw": a team, a game, AND a team id
 * the table knows. `PickHero` falls through to `NoPickHero` on null;
 * `PickStickyBar` renders nothing at all.
 *
 * Both surfaces route through this rather than repeating the ladder, so the bar
 * can never claim a pick the hero is drawing as "No Pick Made". `game` is
 * returned alongside the team because callers need it narrowed afterwards for
 * `game.kickoff` and `game.id`.
 */
export function resolvePick(
  teamId: TeamId | null,
  game: Game | undefined,
): { team: Team; game: Game } | null {
  if (!teamId || !game) return null;
  const team = getTeam(teamId);
  return team ? { team, game } : null;
}

/**
 * True once the pick module's bottom edge is at or above the top of the
 * viewport — the moment the sticky bar takes over from it.
 *
 * One clause, deliberately. `!isIntersecting && top < 0` says the same thing for
 * a module shorter than the viewport (242px against ~852) and stops saying it
 * the moment that stops holding. This is a literal transcription of the trigger
 * instead: the module has gone past the top.
 */
export function heroScrolledPast(rect: { bottom: number }): boolean {
  return rect.bottom <= 0;
}

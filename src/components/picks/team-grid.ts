import { getTeam, TEAMS, type TeamId } from "../../lib/nfl/teams";
import { isKickedOff, type Game, type Team } from "../../lib/nfl/types";
import { isHome, orderPickerTeams, type TeamAvailability } from "../../lib/league/view";
import type { TeamRecord } from "../../lib/league/types";

/**
 * The pure half of the grid pick layout — availability, ordering and every
 * string the cards print.
 *
 * It lives apart from `TeamGrid.tsx` because vitest runs in the Node environment
 * here; there is no jsdom and no @testing-library, so a pure module is the only
 * testable shape. Same split as `pick-hero.ts` and `week-strip.ts`.
 */

export const GRID_LAYOUTS = ["grid", "matchups"] as const;
/** Which pick surface is on screen. */
export type GridLayout = (typeof GRID_LAYOUTS)[number];

/**
 * What a card says about its team this week.
 *
 * `locked` is not in the Figma state set but is a real condition the matchup
 * layout already handles: the team's game has kicked off, so the pick can no
 * longer move. It borrows the disabled styling.
 */
export type CardState = "available" | "selected" | "used" | "bye" | "locked";

export interface GridCard {
  teamId: TeamId;
  team: Team;
  state: CardState;
  /** The week this team was spent in — set only when `state` is "used". */
  usedWeek: number | null;
  /** Whether clicking it can actually change the pick. */
  selectable: boolean;
  /** This team's game in the week on screen, if it has one. */
  game: Game | undefined;
}

/**
 * A card for every one of the 32 teams, in `TEAMS` order.
 *
 * Always 32: a team on bye or already spent is rendered disabled rather than
 * dropped, so the grid is the same shape every week and a team never simply
 * vanishes without saying why.
 *
 * Bye is derived from `games` rather than taken as a parameter — a team with no
 * fixture in the week on screen *is* on bye, and deriving it means the card's
 * state and the opponent it prints can never disagree. The caller is responsible
 * for not rendering the grid at all when the week has no schedule yet, which is
 * a different thing from 32 byes.
 */
export function buildGridCards(input: {
  /** The viewed week's games — already phase-correct (regular or practice). */
  games: readonly Game[];
  /** Teams spent in other weeks of this phase, with the week they went. */
  usedByTeam: ReadonlyMap<TeamId, { week: number }>;
  selectedTeam: TeamId | null;
  /**
   * Whether this week may be WRITTEN to — false only on a week already played.
   *
   * Named before picking ahead existed, when "writable" and "the live week"
   * were the same set. They are not any more: every week from the live one
   * forward is interactive, and per-game kickoff is what locks an individual
   * card inside it.
   */
  interactive: boolean;
  now: Date;
}): Map<TeamId, GridCard> {
  const gameFor = new Map<TeamId, Game>();
  for (const game of input.games) {
    gameFor.set(game.home, game);
    gameFor.set(game.away, game);
  }

  const cards = new Map<TeamId, GridCard>();
  for (const team of TEAMS) {
    const game = gameFor.get(team.id);
    const used = input.usedByTeam.get(team.id);
    const kicked = game ? isKickedOff(game, input.now) : false;

    // Precedence matters. `selected` wins outright: on a week you are only
    // previewing, or after your game has kicked off, your own pick is not
    // selectable — and labelling it "locked" would bury the one fact that
    // matters, which is that this is the team you went with.
    //
    // `locked` is gated on `interactive` for the same reason the matchup layout
    // gates its copy: every game in a past week has kicked off, and a wall of 32
    // "Locked" cards says nothing you didn't already know from the week strip.
    const state: CardState =
      input.selectedTeam === team.id
        ? "selected"
        : used
          ? "used"
          : !game
            ? "bye"
            : kicked && input.interactive
              ? "locked"
              : "available";

    cards.set(team.id, {
      teamId: team.id,
      team,
      state,
      usedWeek: used?.week ?? null,
      selectable: input.interactive && !used && game !== undefined && !kicked,
      game,
    });
  }
  return cards;
}

/** The grid's card state in the vocabulary `orderPickerTeams` speaks. */
function availabilityOf(card: GridCard): TeamAvailability {
  switch (card.state) {
    case "selected":
      return { state: "selected" };
    case "used":
      return { state: "used", week: card.usedWeek ?? 0 };
    case "bye":
      return { state: "bye" };
    default:
      // `locked` has no availability of its own; for ordering it ranks as a
      // team you simply aren't taking this week.
      return { state: "available" };
  }
}

/**
 * The order cards are laid out in — left to right, then down: best record first.
 *
 * `groupUnavailable: false` is the whole point: bye and already-spent teams sort
 * in place rather than sinking, so this reads as a straight ranking of all 32
 * and a card never moves just because you happened to spend it.
 *
 * It used to take the Sort filter's choice. That filter is gone from the design
 * and the record ranking was its stored default, so this is what everyone who
 * never touched the control was already looking at. The other option, "ABCs",
 * was `sort: "default"` — a passthrough, since `TEAMS` is already alphabetical
 * by city and then nickname.
 */
export function orderGridTeams(
  cards: ReadonlyMap<TeamId, GridCard>,
  recordFor: (id: TeamId) => TeamRecord,
): TeamId[] {
  const states = new Map<TeamId, TeamAvailability>();
  for (const [id, card] of cards) states.set(id, availabilityOf(card));

  return orderPickerTeams(
    TEAMS.map((t) => t.id),
    states,
    { sort: "record", availableOnly: false, groupUnavailable: false },
    { recordFor, gameFor: (id) => cards.get(id)?.game },
  );
}

/** "CIN Bengals" — the abbreviation carries the city in four characters. */
export function cardTitle(team: Team): string {
  return `${team.abbr} ${team.name}`;
}

/**
 * "Home vs. Chargers".
 *
 * The nickname alone, not "LAC Chargers" as the mockup spells it: all 32
 * nicknames are unique, and at 10px in a 118px card on a 393px phone
 * "Away vs. WSH Commanders" clips where "Away vs. Commanders" does not.
 */
export function matchupLabel(teamId: TeamId, game: Game | undefined): string {
  if (!game) return "BYE Week";
  const home = isHome(game, teamId);
  const side = home ? "Home" : "Away";
  // Not `getTeam(...)!`. games.home/away are bare text with no foreign key, so
  // a bad row can carry a code that isn't one of the 32; print the side alone
  // rather than "vs. undefined".
  const opponent = getTeam(home ? game.away : game.home);
  return opponent ? `${side} vs. ${opponent.name}` : side;
}

/** The line under the team name. */
export function cardSubtitle(card: GridCard): string {
  switch (card.state) {
    case "used":
      return "Already Selected";
    case "bye":
      return "BYE Week";
    case "locked":
      return "Locked";
    default:
      return matchupLabel(card.teamId, card.game);
  }
}

/**
 * The card's accessible name, composed by state precedence exactly as the
 * matchup layout composes its rows — the greyscale logo is never the only
 * signal that a card is out of play.
 */
export function cardAriaLabel(card: GridCard, record: string): string {
  const name = `${card.team.location} ${card.team.name}`;
  const matchup = matchupLabel(card.teamId, card.game);
  switch (card.state) {
    case "selected":
      return `${name}, record ${record}, ${matchup}, your pick`;
    case "used":
      return `${name}, already used in Week ${card.usedWeek}`;
    case "bye":
      return `${name}, on bye this week`;
    case "locked":
      return `${name}, ${matchup}, locked — the game has kicked off`;
    default:
      return card.selectable
        ? `Pick the ${name}, record ${record}, ${matchup}`
        : `${name}, record ${record}, ${matchup}, not selectable`;
  }
}

import { describe, expect, it } from "vitest";
import type { Game, TeamId } from "../../lib/nfl/types";
import type { TeamRecord } from "../../lib/league/types";
import { TEAM_COUNT } from "../../lib/nfl/teams";
import {
  buildGridCards,
  cardAriaLabel,
  cardSubtitle,
  cardTitle,
  matchupLabel,
  orderGridTeams,
  type GridCard,
} from "./team-grid";

const KICKOFF = "2025-10-12T17:00:00.000Z";
const BEFORE = new Date("2025-10-12T12:00:00.000Z");
const AFTER = new Date("2025-10-12T18:00:00.000Z");

function game(home: TeamId, away: TeamId, kickoff = KICKOFF): Game {
  return {
    id: `g_${home}_${away}`,
    season: 2025,
    seasonType: "regular",
    week: 6,
    kickoff,
    status: "scheduled",
    home,
    away,
    homeScore: null,
    awayScore: null,
  };
}

// cin v bal and kc v buf play; everyone else is on bye for these fixtures.
const GAMES = [game("cin", "bal"), game("kc", "buf")];

function cards(over: Partial<Parameters<typeof buildGridCards>[0]> = {}) {
  return buildGridCards({
    games: GAMES,
    usedByTeam: new Map(),
    selectedTeam: null,
    interactive: true,
    now: BEFORE,
    ...over,
  });
}

describe("buildGridCards", () => {
  it("always returns a card for all 32 teams", () => {
    // The grid is the same shape every week — a spent or idle team is disabled,
    // never dropped.
    expect(cards().size).toBe(TEAM_COUNT);
    expect(TEAM_COUNT).toBe(32);
  });

  it("marks a team with no fixture as on bye", () => {
    const card = cards().get("sea")!;
    expect(card.state).toBe("bye");
    expect(card.selectable).toBe(false);
    expect(card.game).toBeUndefined();
  });

  it("marks a playing team available and selectable", () => {
    const card = cards().get("cin")!;
    expect(card.state).toBe("available");
    expect(card.selectable).toBe(true);
    expect(card.game?.id).toBe("g_cin_bal");
  });

  it("marks a spent team used, and carries the week it went", () => {
    const card = cards({ usedByTeam: new Map([["cin", { week: 3 }]]) }).get("cin")!;
    expect(card.state).toBe("used");
    expect(card.usedWeek).toBe(3);
    expect(card.selectable).toBe(false);
  });

  it("locks a team whose game has kicked off", () => {
    const card = cards({ now: AFTER }).get("cin")!;
    expect(card.state).toBe("locked");
    expect(card.selectable).toBe(false);
  });

  it("does not label anything locked on a week already played", () => {
    // Every game in a past week has kicked off; 32 "Locked" cards would say
    // nothing the week strip hasn't already said.
    const card = cards({ now: AFTER, interactive: false }).get("cin")!;
    expect(card.state).toBe("available");
    expect(card.selectable).toBe(false);
  });

  /**
   * Picking ahead in one assertion. A week ahead of the live one is handed
   * `interactive: true` and nothing in it has kicked off, so every card is
   * ordinary and pickable — and because `TeamGrid`'s greyscale ternary keys on
   * `selectable`, those cards come up in team colours too.
   */
  it("keeps a future week's cards selectable", () => {
    const all = [...cards({ now: BEFORE, interactive: true }).values()];
    const playing = all.filter((c) => c.game !== undefined);

    expect(playing.length).toBeGreaterThan(0);
    expect(playing.every((c) => c.selectable)).toBe(true);
    expect(cards({ now: BEFORE, interactive: true }).get("cin")!.state).toBe("available");
  });

  it("shows your pick as selected even once its game has kicked off", () => {
    // `selected` outranks `locked` — burying it would hide the one fact that
    // matters, which is the team you went with.
    const card = cards({ selectedTeam: "cin", now: AFTER }).get("cin")!;
    expect(card.state).toBe("selected");
    expect(card.selectable).toBe(false);
  });

  it("shows your pick as selected on a week you are only previewing", () => {
    const card = cards({ selectedTeam: "cin", interactive: false }).get("cin")!;
    expect(card.state).toBe("selected");
    expect(card.selectable).toBe(false);
  });

  it("outranks used with selected, so this week's pick is never struck out", () => {
    // My Picks excludes the viewed week from its own used list, but belt and
    // braces: the selection wins if both ever arrive together.
    const card = cards({
      selectedTeam: "cin",
      usedByTeam: new Map([["cin", { week: 6 }]]),
    }).get("cin")!;
    expect(card.state).toBe("selected");
  });

  it("prefers used over bye for a team spent earlier and idle now", () => {
    const card = cards({ usedByTeam: new Map([["sea", { week: 2 }]]) }).get("sea")!;
    expect(card.state).toBe("used");
  });

  it("makes nothing selectable on a week already played", () => {
    const all = [...cards({ interactive: false }).values()];
    expect(all.every((c) => !c.selectable)).toBe(true);
  });
});

const RECORDS: Record<string, TeamRecord> = {
  kc: { w: 5, l: 1, t: 0 },
  buf: { w: 4, l: 2, t: 0 },
  cin: { w: 1, l: 5, t: 0 },
  bal: { w: 3, l: 2, t: 1 },
};
const recordFor = (id: TeamId): TeamRecord => RECORDS[id] ?? { w: 0, l: 0, t: 0 };

describe("orderGridTeams", () => {
  it("keeps every team in the layout", () => {
    expect(orderGridTeams(cards(), recordFor)).toHaveLength(TEAM_COUNT);
  });

  it("sorts Team Record best first, with a half-credit tie", () => {
    const order = orderGridTeams(cards(), recordFor);
    // kc 5-1 = .833, buf 4-2 = .667, bal 3-2-1 = (3 + 0.5) / 6 = .583,
    // cin 1-5 = .167, then everyone else at .000. The half-credit tie is what
    // puts bal below buf despite the same two losses.
    expect(order.slice(0, 4)).toEqual(["kc", "buf", "bal", "cin"]);
  });

  it("leaves bye and used teams in place rather than sinking them", () => {
    // The user's call: Team Record reads as a straight ranking of all 32, so a
    // card never moves merely because you happened to spend it.
    const withUsed = cards({ usedByTeam: new Map([["kc", { week: 3 }]]) });
    expect(orderGridTeams(withUsed, recordFor)[0]).toBe("kc");
    // bal is on a bye in a schedule where only cin/kc games exist? No — bal
    // plays cin. sea does not, and still sorts by its record.
    const order = orderGridTeams(cards(), recordFor);
    expect(order.indexOf("sea")).toBeLessThan(order.indexOf("wsh"));
  });

  it("falls back to the base order for teams on equal records", () => {
    // Every team outside RECORDS is 0-0; a stable sort keeps TEAMS order.
    const order = orderGridTeams(cards(), recordFor).filter((id) => !(id in RECORDS));
    expect(order.slice(0, 3)).toEqual(["ari", "atl", "car"]);
  });
});

describe("card copy", () => {
  const all = cards({
    selectedTeam: "kc",
    usedByTeam: new Map([["dal", { week: 3 }]]),
  });

  it("titles a card with the abbreviation and nickname", () => {
    expect(cardTitle(all.get("cin")!.team)).toBe("CIN Bengals");
  });

  it("names the opponent by nickname, with the side first", () => {
    expect(matchupLabel("cin", all.get("cin")!.game)).toBe("Home vs. Ravens");
    expect(matchupLabel("bal", all.get("bal")!.game)).toBe("Away vs. Bengals");
  });

  it("degrades to the side alone when a game names a team we don't know", () => {
    // games.home/away are bare text with no foreign key.
    expect(matchupLabel("cin", game("cin", "xyz"))).toBe("Home");
  });

  it("says BYE Week when there is no game", () => {
    expect(matchupLabel("sea", undefined)).toBe("BYE Week");
    expect(cardSubtitle(all.get("sea")!)).toBe("BYE Week");
  });

  it("replaces the matchup with the reason a card is out of play", () => {
    expect(cardSubtitle(all.get("dal")!)).toBe("Already Selected");
    expect(cardSubtitle(cards({ now: AFTER }).get("cin")!)).toBe("Locked");
  });

  it("keeps the matchup on a selectable card", () => {
    expect(cardSubtitle(all.get("cin")!)).toBe("Home vs. Ravens");
  });
});

describe("cardAriaLabel", () => {
  const all = cards({
    selectedTeam: "kc",
    usedByTeam: new Map([["dal", { week: 3 }]]),
  });
  const label = (card: GridCard) => cardAriaLabel(card, "5-1");

  it("leads with your pick, not with the fact it is no longer selectable", () => {
    expect(label(all.get("kc")!)).toBe(
      "Kansas City Chiefs, record 5-1, Home vs. Bills, your pick",
    );
  });

  it("names the week a used team went", () => {
    expect(label(all.get("dal")!)).toBe("Dallas Cowboys, already used in Week 3");
  });

  it("says a bye out loud, so the greyscale logo is never the only signal", () => {
    expect(label(all.get("sea")!)).toBe("Seattle Seahawks, on bye this week");
  });

  it("invites the action on a selectable card", () => {
    expect(label(all.get("cin")!)).toBe(
      "Pick the Cincinnati Bengals, record 5-1, Home vs. Ravens",
    );
  });

  it("says not selectable on a week already played", () => {
    const previewing = cards({ interactive: false });
    expect(label(previewing.get("cin")!)).toBe(
      "Cincinnati Bengals, record 5-1, Home vs. Ravens, not selectable",
    );
  });

  it("explains a locked card", () => {
    expect(label(cards({ now: AFTER }).get("cin")!)).toBe(
      "Cincinnati Bengals, Home vs. Ravens, locked — the game has kicked off",
    );
  });
});

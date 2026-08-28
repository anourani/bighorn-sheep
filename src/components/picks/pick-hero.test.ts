import { describe, expect, it } from "vitest";
import {
  eyebrowFor,
  heroScrolledPast,
  hexToRgb,
  matchupLine,
  resolvePick,
  stripGradient,
} from "./pick-hero";
import type { Game, TeamId } from "../../lib/nfl/types";

/** CIN hosting LAC — the matchup the sticky bar's Figma frame draws. */
const GAME: Game = {
  id: "401547001",
  season: 2026,
  seasonType: "regular",
  week: 6,
  kickoff: "2026-09-13T20:00:00Z",
  status: "scheduled",
  home: "cin",
  away: "lac",
  homeScore: null,
  awayScore: null,
};


describe("stripGradient", () => {
  // The value in the design, spelled out: Bengals #FB4F14 is rgb(251,79,20).
  it("ramps the team colour from 25% to 80% down the strip", () => {
    expect(stripGradient("#FB4F14", "down")).toBe(
      "linear-gradient(180deg, rgba(251,79,20,0.25) 0%, rgba(251,79,20,0.8) 100%)",
    );
  });

  it("reverses the ramp for the middle strip", () => {
    expect(stripGradient("#FB4F14", "up")).toBe(
      "linear-gradient(180deg, rgba(251,79,20,0.8) 0%, rgba(251,79,20,0.25) 100%)",
    );
  });

  // Both directions span the same two alphas, so the three strips are one
  // family and not two different washes that happen to sit side by side.
  it("uses the same endpoints in both directions", () => {
    const alphas = (css: string) => [...css.matchAll(/,([\d.]+)\)/g)].map((m) => m[1]).sort();
    expect(alphas(stripGradient("#0085CA", "down"))).toEqual(alphas(stripGradient("#0085CA", "up")));
  });

  // A pure-black team is the extreme the fixed ramp was accepted for: no
  // lightening, so the strip runs grey to near-black.
  it("gives a black team the same treatment as any other", () => {
    expect(stripGradient("#000000", "down")).toBe(
      "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.8) 100%)",
    );
  });
});

describe("hexToRgb", () => {
  it("reads six-digit hex", () => {
    expect(hexToRgb("#FFB612")).toEqual([255, 182, 18]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("expands three-digit hex", () => {
    expect(hexToRgb("#0AF")).toEqual([0, 170, 255]);
  });

  it("does not require the leading hash", () => {
    expect(hexToRgb("FB4F14")).toEqual([251, 79, 20]);
  });
});

describe("eyebrowFor", () => {
  // One sentence, two surfaces: the hero spells the week out and the sticky bar
  // abbreviates it, but neither invents its own wrapper.
  it("wraps whatever week label it is handed", () => {
    expect(eyebrowFor("Week 6")).toBe("Your Week 6 Pick");
    expect(eyebrowFor("WK6")).toBe("Your WK6 Pick");
    expect(eyebrowFor("Hall of Fame")).toBe("Your Hall of Fame Pick");
  });
});

describe("matchupLine", () => {
  it("says vs. at home and @ away", () => {
    expect(matchupLine(GAME, "cin", "short")).toBe("vs. Chargers");
    expect(matchupLine(GAME, "lac", "short")).toBe("@ Bengals");
  });

  // The long form is the sticky bar's, and it is `abbr + name` — the same
  // abbreviation the team cards on this page already use ("CIN Bengals").
  it("prefixes the abbreviation in the long form", () => {
    expect(matchupLine(GAME, "cin", "long")).toBe("vs. LAC Chargers");
    expect(matchupLine(GAME, "lac", "long")).toBe("@ CIN Bengals");
  });

  // games.home/away are bare text with no foreign key, so a bad row can carry a
  // code that is not one of the 32. Print the side rather than "vs. undefined".
  it("falls back to TBD in both forms when the opponent is unknown", () => {
    const bad: Game = { ...GAME, away: "zzz" as TeamId };
    expect(matchupLine(bad, "cin", "short")).toBe("vs. TBD");
    expect(matchupLine(bad, "cin", "long")).toBe("vs. TBD");
  });
});

describe("resolvePick", () => {
  // The one definition of "there is a pick to draw". PickHero falls through to
  // NoPickHero on null and PickStickyBar renders nothing, so a disagreement here
  // would put a sticky bar over a hero reading "No Pick Made".
  it("needs a team, a game, and a team the table knows", () => {
    expect(resolvePick(null, GAME)).toBeNull();
    expect(resolvePick("cin", undefined)).toBeNull();
    expect(resolvePick("zzz" as TeamId, GAME)).toBeNull();
  });

  it("returns the team and the game together", () => {
    const view = resolvePick("cin", GAME);
    expect(view?.team.name).toBe("Bengals");
    // The game comes back so callers get it narrowed for `kickoff` and `id`
    // without a second guard that could drift from this one.
    expect(view?.game).toBe(GAME);
  });
});

describe("heroScrolledPast", () => {
  // The trigger, spelled literally: the pick module's bottom edge has reached
  // the top of the viewport.
  it("is false while any of the module is still on screen", () => {
    expect(heroScrolledPast({ bottom: 400 })).toBe(false);
    expect(heroScrolledPast({ bottom: 1 })).toBe(false);
  });

  it("turns true exactly at the edge, and stays true above it", () => {
    expect(heroScrolledPast({ bottom: 0 })).toBe(true);
    expect(heroScrolledPast({ bottom: -50 })).toBe(true);
  });
});

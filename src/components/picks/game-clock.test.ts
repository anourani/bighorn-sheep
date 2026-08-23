import { describe, expect, it } from "vitest";

import { gameClockLabel } from "./game-clock";
import type { GameStatus } from "@/lib/nfl/types";

const game = (status: GameStatus, statusDetail?: string) => ({ status, statusDetail });

describe("gameClockLabel", () => {
  describe("a live game", () => {
    // ESPN's real `type.shortDetail`. Nothing in this repo pins it, which is the
    // whole reason both orders are supported.
    it("reads ESPN's clock-first shape", () => {
      expect(gameClockLabel(game("in_progress", "4:31 - 2nd"))).toBe("2Q 4:31");
      expect(gameClockLabel(game("in_progress", "0:12 - 4th"))).toBe("4Q 0:12");
    });

    // What `mock/data.ts` and `scripts/sim-advance.ts` write, and what
    // `nfl/types.ts` documents. A parser built on only this shape would pass
    // every test in the repo and still be wrong against production.
    it("reads the repo's own period-first shape", () => {
      expect(gameClockLabel(game("in_progress", "2nd 05:12"))).toBe("2Q 5:12");
      expect(gameClockLabel(game("in_progress", "1st 15:00"))).toBe("1Q 15:00");
    });

    it("strips a padded minute but never a real one", () => {
      expect(gameClockLabel(game("in_progress", "3rd 09:00"))).toBe("3Q 9:00");
      expect(gameClockLabel(game("in_progress", "3rd 10:00"))).toBe("3Q 10:00");
      // The seconds' zeros are not the padding being stripped.
      expect(gameClockLabel(game("in_progress", "2nd 00:33"))).toBe("2Q 0:33");
    });

    it("keeps overtime named rather than calling it 5Q", () => {
      expect(gameClockLabel(game("in_progress", "1:20 - OT"))).toBe("OT 1:20");
      expect(gameClockLabel(game("in_progress", "OT 01:20"))).toBe("OT 1:20");
      expect(gameClockLabel(game("in_progress", "2OT 03:00"))).toBe("2OT 3:00");
    });

    it("accepts a bare period number", () => {
      expect(gameClockLabel(game("in_progress", "7:45 - 3"))).toBe("3Q 7:45");
    });

    it("is case-insensitive about the period", () => {
      expect(gameClockLabel(game("in_progress", "4:31 - 2ND"))).toBe("2Q 4:31");
    });

    // The fallthrough is the point: these carry no clock, so there is nothing to
    // parse and the feed's own wording is already the right answer.
    it("passes a clockless phrase through verbatim", () => {
      expect(gameClockLabel(game("in_progress", "Halftime"))).toBe("Halftime");
      expect(gameClockLabel(game("in_progress", "End of 1st"))).toBe("End of 1st");
      expect(gameClockLabel(game("in_progress", "End of 3rd"))).toBe("End of 3rd");
    });

    it("passes an unrecognised string through rather than blanking the slot", () => {
      expect(gameClockLabel(game("in_progress", "Two Minute Warning"))).toBe("Two Minute Warning");
    });

    it("falls back to the kickoff time when the feed said nothing", () => {
      expect(gameClockLabel(game("in_progress"))).toBeNull();
      expect(gameClockLabel(game("in_progress", "   "))).toBeNull();
    });
  });

  describe("a finished game", () => {
    it("keeps the feed's wording when it already reads as final", () => {
      expect(gameClockLabel(game("final", "Final"))).toBe("Final");
      expect(gameClockLabel(game("final", "Final/OT"))).toBe("Final/OT");
    });

    it("says Final regardless of what else the feed sent", () => {
      expect(gameClockLabel(game("final"))).toBe("Final");
      expect(gameClockLabel(game("final", "4:31 - 2nd"))).toBe("Final");
    });
  });

  describe("a game that has not been played", () => {
    // The load-bearing one. A scheduled game's `statusDetail` is a formatted
    // DATE, it is persisted by `gameToRow`, and it matches the clock-first regex
    // on its way past — so without the status check every unplayed game would
    // print a date where its kickoff time belongs.
    it("never renders a scheduled game's date-shaped detail", () => {
      expect(gameClockLabel(game("scheduled", "9/7 - 1:00 PM EDT"))).toBeNull();
      expect(gameClockLabel(game("scheduled"))).toBeNull();
    });

    it("falls back to the kickoff time when delayed or postponed", () => {
      expect(gameClockLabel(game("delayed", "Delayed"))).toBeNull();
      expect(gameClockLabel(game("postponed", "Postponed"))).toBeNull();
    });
  });
});

import { describe, expect, it } from "vitest";
import { isEntryWritable } from "./writability";

const live = { isCurrent: true, viewingFuture: false } as const;
const future = { isCurrent: false, viewingFuture: true } as const;
const past = { isCurrent: false, viewingFuture: false } as const;

describe("isEntryWritable", () => {
  it("opens the live week and every week after it", () => {
    expect(isEntryWritable({ ...live, entryStatus: "alive" })).toBe(true);
    expect(isEntryWritable({ ...future, entryStatus: "alive" })).toBe(true);
  });

  it("closes a week that has been played", () => {
    expect(isEntryWritable({ ...past, entryStatus: "alive" })).toBe(false);
  });

  it("closes EVERY week for an eliminated entry, the live one included", () => {
    // The bug this is the fix for: the screen read the week and nothing else,
    // so an eliminated player saw a live grid, tapped a card, watched it paint
    // optimistically and watched it snap back under "You're eliminated, so
    // picks are closed." `canPick` had been refusing it all along.
    expect(isEntryWritable({ ...live, entryStatus: "eliminated" })).toBe(false);
    expect(isEntryWritable({ ...future, entryStatus: "eliminated" })).toBe(false);
    expect(isEntryWritable({ ...past, entryStatus: "eliminated" })).toBe(false);
  });

  it("gates on the ENTRY, so one entry going out leaves the other playable", () => {
    // Two entries of one person are eliminated independently (0017). Read off
    // the person, either casualty would close both screens.
    expect(isEntryWritable({ ...live, entryStatus: "eliminated" })).toBe(false);
    expect(isEntryWritable({ ...live, entryStatus: "alive" })).toBe(true);
  });
});

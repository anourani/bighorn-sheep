import { describe, expect, it } from "vitest";
import { isEntryWritable } from "./writability";

const live = { isCurrent: true, viewingFuture: false, pickLocked: false } as const;
const future = { isCurrent: false, viewingFuture: true, pickLocked: false } as const;
const past = { isCurrent: false, viewingFuture: false, pickLocked: false } as const;

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

  it("closes the live week once this week's pick has kicked off", () => {
    // The whole week, not just the card you took. A Thursday-night pick locks
    // while the Sunday games are still scheduled, so the per-card kickoff test
    // left 30 cards in colour with enabled radios — inviting a tap that would
    // rewrite a pick already in play. RLS refused that write and reported no
    // error, so the screen said it had saved.
    expect(isEntryWritable({ ...live, pickLocked: true, entryStatus: "alive" })).toBe(false);
  });

  it("closes a future week too — the gate is not live-week-only", () => {
    // Unreachable today (a future week's games have not kicked off, so nothing
    // in one can lock), and stated anyway: a gate that only fires on the live
    // week would fail OPEN the day anything else can set this.
    expect(isEntryWritable({ ...future, pickLocked: true, entryStatus: "alive" })).toBe(false);
  });

  it("leaves the week open when this week's pick has NOT kicked off", () => {
    // Changing an un-started pick is still allowed, and is most of what the
    // screen is for. Closing here would break picking ahead outright.
    expect(isEntryWritable({ ...live, pickLocked: false, entryStatus: "alive" })).toBe(true);
    expect(isEntryWritable({ ...future, pickLocked: false, entryStatus: "alive" })).toBe(true);
  });

  it("leaves the week open for a member who has not picked at all", () => {
    // The case this must not over-reach into: the Thursday game has kicked off
    // but you are committed to nothing, so the rest of the slate is still
    // yours to take. `pickLocked` is false with no pick, and the started game's
    // own two teams are closed by `buildGridCards` rather than by this gate.
    expect(isEntryWritable({ ...live, pickLocked: false, entryStatus: "alive" })).toBe(true);
  });

  it("reports eliminated ahead of locked when both apply", () => {
    // Not a behaviour difference here — both close the week — but the order is
    // what `MyPicksClient`'s standing notice mirrors, and elimination is the
    // larger fact: it closes every week, where a lock closes only this one.
    expect(isEntryWritable({ ...live, pickLocked: true, entryStatus: "eliminated" })).toBe(false);
  });
});

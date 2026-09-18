import { describe, expect, it } from "vitest";
import { isEntryWritable } from "./writability";

const live = { isCurrent: true, viewingFuture: false, pickLocked: false } as const;
const future = { isCurrent: false, viewingFuture: true, pickLocked: false } as const;
const past = { isCurrent: false, viewingFuture: false, pickLocked: false } as const;

describe("isEntryWritable", () => {
  it("opens the live week and every week after it", () => {
    expect(isEntryWritable({ ...live })).toBe(true);
    expect(isEntryWritable({ ...future })).toBe(true);
  });

  it("closes a week that has been played", () => {
    expect(isEntryWritable({ ...past })).toBe(false);
  });

  it("takes no entry status — an eliminated entry writes on the same terms", () => {
    // This gate used to close every week for an eliminated entry, mirroring a
    // `canPick` that refused it. Both are gone together: a knocked-out entry
    // keeps picking, privately, and its grid stays live. The input shape has
    // no status field, so the screen cannot re-add the test without changing
    // the type — which is the point. Where those picks are HIDDEN is
    // `lib/league/post-elimination.ts` and 0020's SQL, not this gate.
    const input: Parameters<typeof isEntryWritable>[0] = { ...live };
    expect("entryStatus" in input).toBe(false);
    expect(isEntryWritable(input)).toBe(true);
    expect(isEntryWritable({ ...future })).toBe(true);
  });

  it("closes the live week once this week's pick has kicked off", () => {
    // The whole week, not just the card you took. A Thursday-night pick locks
    // while the Sunday games are still scheduled, so the per-card kickoff test
    // left 30 cards in colour with enabled radios — inviting a tap that would
    // rewrite a pick already in play. RLS refused that write and reported no
    // error, so the screen said it had saved.
    expect(isEntryWritable({ ...live, pickLocked: true })).toBe(false);
  });

  it("closes a future week too — the gate is not live-week-only", () => {
    // Unreachable today (a future week's games have not kicked off, so nothing
    // in one can lock), and stated anyway: a gate that only fires on the live
    // week would fail OPEN the day anything else can set this.
    expect(isEntryWritable({ ...future, pickLocked: true })).toBe(false);
  });

  it("leaves the week open when this week's pick has NOT kicked off", () => {
    // Changing an un-started pick is still allowed, and is most of what the
    // screen is for. Closing here would break picking ahead outright.
    expect(isEntryWritable({ ...live, pickLocked: false })).toBe(true);
    expect(isEntryWritable({ ...future, pickLocked: false })).toBe(true);
  });

  it("leaves the week open for a member who has not picked at all", () => {
    // The case this must not over-reach into: the Thursday game has kicked off
    // but you are committed to nothing, so the rest of the slate is still
    // yours to take. `pickLocked` is false with no pick, and the started game's
    // own two teams are closed by `buildGridCards` rather than by this gate.
    expect(isEntryWritable({ ...live, pickLocked: false })).toBe(true);
  });
});

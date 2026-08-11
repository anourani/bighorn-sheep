import { describe, expect, it } from "vitest";
import { resolveActiveGroupId } from "./active";

describe("resolveActiveGroupId", () => {
  it("honours the preferred league when the viewer is a member", () => {
    expect(resolveActiveGroupId(["a", "b", "c"], "b")).toBe("b");
  });

  it("falls back to the earliest-joined league when nothing is preferred", () => {
    expect(resolveActiveGroupId(["a", "b"])).toBe("a");
    expect(resolveActiveGroupId(["a", "b"], null)).toBe("a");
    expect(resolveActiveGroupId(["a", "b"], "")).toBe("a");
  });

  // The cookie outlives the membership: leave a league (or sign in as someone
  // else on a shared phone) and it still names a group you cannot read. Without
  // this fallback loadLeague would query a group RLS hides and report no_group
  // to a player who is in two.
  it("ignores a stale cookie naming a league the viewer no longer belongs to", () => {
    expect(resolveActiveGroupId(["a", "b"], "gone")).toBe("a");
  });

  it("returns null when the viewer is in no leagues", () => {
    expect(resolveActiveGroupId([], "a")).toBeNull();
    expect(resolveActiveGroupId([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolveActiveGroupId, toLeagueOptions } from "./active";

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

describe("toLeagueOptions", () => {
  // The reason this function exists. `loadLeague` orders memberships by
  // joined_at and then fetches groups with `.in("id", …)`, which returns rows in
  // arbitrary order. If the switcher rendered that order, its first entry could
  // name a different league than resolveActiveGroupId's earliest-joined
  // fallback actually selects — a menu disagreeing with the app.
  it("restores join order regardless of how the group rows come back", () => {
    const groups = [
      { id: "c", name: "Third" },
      { id: "a", name: "First" },
      { id: "b", name: "Second" },
    ];
    expect(toLeagueOptions(["a", "b", "c"], groups)).toEqual([
      { id: "a", name: "First" },
      { id: "b", name: "Second" },
      { id: "c", name: "Third" },
    ]);
  });

  // RLS can hide a group a membership row still points at. A nameless option is
  // an unlabelled, unpickable dead entry in a native <select>, so drop it.
  it("drops ids with no matching group row", () => {
    expect(toLeagueOptions(["a", "ghost", "b"], [{ id: "b", name: "B" }, { id: "a", name: "A" }])).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
  });

  it("ignores group rows the viewer has no membership for", () => {
    expect(toLeagueOptions(["a"], [{ id: "a", name: "A" }, { id: "z", name: "Z" }])).toEqual([
      { id: "a", name: "A" },
    ]);
  });

  it("returns [] when either side is empty", () => {
    expect(toLeagueOptions([], [{ id: "a", name: "A" }])).toEqual([]);
    expect(toLeagueOptions(["a"], [])).toEqual([]);
  });

  it("carries only id and name, whatever else the row has", () => {
    const rows = [{ id: "a", name: "A", season: 2026, invite_code: "SECRET" }];
    expect(toLeagueOptions(["a"], rows)).toEqual([{ id: "a", name: "A" }]);
  });
});

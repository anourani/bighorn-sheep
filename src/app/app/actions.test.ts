import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for `submitPick`'s write path, shaped like
 * `my-picks-client.test.ts`.
 *
 * Source-reading is the only shape available here: `actions.ts` is `"use
 * server"` over a Supabase client built from request cookies, so there is
 * nothing to call in the Node environment vitest runs in. The behavioural half
 * of these rules lives in `lib/game/elimination.test.ts`, which tests `canPick`
 * and `isExistingPickLocked` directly; what these pin is that the action still
 * routes through them, and in the right order.
 *
 * They exist because of one failure that was invisible from both ends. A member
 * whose pick for the live week had kicked off could still tap any team whose own
 * game had not — `canPick` was handed the TARGET team's game and never the one
 * the member was already committed to. The database refused those writes all
 * along, and refused them SILENTLY: RLS's `"picks update own before kickoff"`
 * gates the existing row's game in its `using` clause, and a failing `using`
 * removes a row from an UPDATE rather than raising. Zero rows changed, `error`
 * came back null, and the action returned `{ ok: true }` over a pick that had
 * not moved.
 *
 * The limit, stated plainly: reading source cannot prove the action refuses
 * anything. It can only prove the refusal is still wired in.
 */
const ACTIONS = new URL("./actions.ts", import.meta.url);

/** Source with every comment removed — see my-picks-client.test.ts. */
async function code(): Promise<string> {
  return (await readFile(ACTIONS, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Just the `canPick({ … })` argument, so a match elsewhere cannot stand in. */
async function guardArgs(): Promise<string> {
  const src = await code();
  const start = src.indexOf("canPick({");
  expect(start, "submitPick should still call canPick").toBeGreaterThan(0);
  const end = src.indexOf("\n    });", start);
  expect(end, "the canPick call should still close").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("submitPick's frozen-week guard", () => {
  it("hands canPick the pick it would REPLACE, not just the team being tapped", async () => {
    // The bug in one assertion. `game` is the team tapped; `existingPick` is the
    // team already committed. A Thursday-night pick locks while the Sunday
    // fixtures are hours away, so testing only `game` let a member rewrite a
    // pick that was already in play.
    expect(await guardArgs()).toContain("existingPick:");
  });

  it("resolves the existing pick BEFORE the guard runs", async () => {
    // THE ordering guard, and the one that would have caught this class. The
    // lookup used to sit beside the write, forty lines below `canPick` — so the
    // guard structurally could not see it, however the input was named.
    const src = await code();
    const lookup = src.indexOf("const existing = myPicks.find");
    const guard = src.indexOf("canPick({");
    expect(lookup, "submitPick should still resolve the existing pick").toBeGreaterThan(0);
    expect(lookup).toBeLessThan(guard);
  });

  it("resolves it exactly once, covering both phases", async () => {
    // `myPicks` and `games` are already scoped to `seasonType`, so one lookup
    // after the phase branch locks the practice round on the same rule. A second
    // copy is how the two would drift.
    const src = await code();
    expect(src.match(/const existing = myPicks\.find/g)).toHaveLength(1);
  });
});

describe("submitPick's write", () => {
  it("makes the update REPORT what it touched", async () => {
    // Without `.select()` an RLS refusal is indistinguishable from a success:
    // the row is filtered out of the UPDATE, nothing raises, and `error` is
    // null. This is what makes zero rows countable.
    expect(await code()).toMatch(/\.eq\("id", existing\.id\)\s*\.select\(/);
  });

  it("treats a zero-row update as a refusal, not a success", async () => {
    const src = await code();
    expect(src).toContain('written.length === 0');
    expect(src).toContain('error: "pick_locked"');
  });

  it("still reports a landed release as release_failed", async () => {
    // Precedence: the delete DID change the database, so "your pick is locked"
    // would understate it — the member is short a pick with nothing to show.
    const start = (await code()).indexOf("written.length === 0");
    const branch = (await code()).slice(start, start + 600);
    expect(branch).toContain("release_failed");
    expect(branch.indexOf("release_failed")).toBeLessThan(branch.indexOf('"pick_locked"'));
  });
});

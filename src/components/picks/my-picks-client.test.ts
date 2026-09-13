import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the picks screen's write path, shaped like
 * `pick-sticky-bar.test.ts` and `entry-tabs.test.ts`. There is no jsdom here, so
 * nothing renders `MyPicksClient`; what these pin are the decisions that fail
 * SILENTLY — where a tap paints as saved, never reaches the server, and nothing
 * errors anywhere.
 *
 * They exist because of one such failure. The submit-chain map was indexed by
 * the bare week key on the tap side and by `entry|week` on the settle side, so
 * chains were opened in one namespace and settled in another: after the first
 * pick in a week every later tap was swallowed, and the optimistic overlay it
 * had already painted shadowed server truth for the life of the screen. The
 * reported symptom was one team lit on two weeks with no release toast. The
 * behavioural half is `pick-queue.test.ts`; this half is the wiring.
 *
 * The limit, stated plainly: reading source cannot prove a request is sent. It
 * can only prove the screen still routes through the pieces that send it.
 */
const CLIENT = new URL("./MyPicksClient.tsx", import.meta.url);
const QUEUE = new URL("./pick-queue.ts", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/** Source with every comment removed — see pick-sticky-bar.test.ts. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Just handleSelect's body, so a match inside launchPick cannot stand in. */
async function handleSelect(): Promise<string> {
  const src = await code(CLIENT);
  const start = src.indexOf("function handleSelect(");
  expect(start, "handleSelect should still be in MyPicksClient").toBeGreaterThan(0);
  const end = src.indexOf("function launchPick(", start);
  expect(end, "launchPick should still follow handleSelect").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("the submit chains", () => {
  it("names an entry at every chain access, tap side and settle side alike", async () => {
    // THE guard. The bug was one call site out of three reaching the map by a
    // different key, and no assertion could see the difference because each
    // spelling was individually plausible. This walks every access instead.
    const src = await code(CLIENT);
    const uses = [...src.matchAll(/queuesRef\.current\.(\w+)\(\s*([A-Za-z0-9_]+)/g)];
    // A regex matching nothing is a test that passes without looking at anything.
    expect(uses.length, "the screen should still drive its chains through queuesRef").toBe(2);
    for (const [, method, firstArg] of uses) {
      expect(["tap", "settle"]).toContain(method);
      expect(firstArg).toMatch(/^(activeEntryNo|entryNo)$/);
    }
  });

  it("keeps no raw map of chains for a week key to index", async () => {
    const src = await code(CLIENT);
    expect(src).not.toMatch(/queuesRef\.current\.(get|set|has|delete)\b/);
    // The key format lives in the store and nowhere else, so the two sides of a
    // read-modify-write structurally cannot spell it differently.
    expect(await code(QUEUE)).toContain("`${entryNo}|${week}`");
    expect(src).not.toContain("${entryNo}|");
  });

  it("sends what the tap resolved, rather than painting an overlay and stopping", async () => {
    // The symptom of the mis-key was `submit === null` forever: the overlay was
    // painted at every tap, `launchPick` was never called, and no toast could
    // fire because the toast is raised from the server's `releasedWeek`.
    expect(await handleSelect()).toContain("if (submit !== null) launchPick(");
  });

  it("reads the entry from the render, not from the async-settle ref", async () => {
    // handleSelect runs synchronously from the tap, and every other value it
    // reads — serverValue, usedByTeam, phasePicks — comes off that same render.
    // `activeEntryRef` is for the settle, where the closure genuinely IS stale;
    // mixing them would key the chain to one entry and compute the release from
    // another, which is this bug's shape one level down.
    const body = await handleSelect();
    expect(body).toContain("queuesRef.current.tap(activeEntryNo,");
    expect(body).not.toContain("activeEntryRef.current");
  });

  it("pins a chain to the entry it was launched under", async () => {
    // Captured at launch and compared against the ref at settle: that
    // comparison is only meaningful because one side is each.
    const src = await code(CLIENT);
    expect(src).toContain("const entryNo = activeEntryNo;");
    expect(src).toContain("activeEntryRef.current === entryNo");
  });
});

describe("the release lookup", () => {
  it("asks committedWeek over the overlay, not over server props alone", async () => {
    // Server props are a round trip behind a release: they still show the freed
    // week holding the team and the new week empty. A second tap in that window
    // would clear the already-empty week and leave the team lit on two chips.
    const src = await code(CLIENT);
    expect(src).toContain("overlaidPhasePicks(");
    expect(src).toContain("committedWeek(phasePicks, teamId, viewRef.week)");
    expect(src).toMatch(/const phasePicks = useMemo\(/);
  });

  it("still raises the toast from the server's answer, never from the guess", async () => {
    // `releaseKey` is the optimistic prediction and is used only to clear a chip
    // and put it back on failure. The server is the only thing that knows a
    // release actually landed, and a trailing tap recurses with no prediction at
    // all — so the sentence has to come off `releasedWeek`.
    const src = await code(CLIENT);
    expect(src).toContain("released = res.data?.releasedWeek ?? null");
    expect(src).toMatch(/if \(released !== null && stillShowing\)/);
  });
});

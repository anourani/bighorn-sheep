import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the League Dues module (Figma `3934:62955`).
 *
 * There is no jsdom here, so nothing renders it — the geometry was measured in
 * Chromium instead. What these pin are the decisions that a later edit would
 * undo silently: a deliberate deviation from the frame reverting to the frame,
 * and an invented placement creeping back after the design replaced it.
 */
const DUES = new URL("./LeagueDues.tsx", import.meta.url);
const MORE = new URL("./MoreSection.tsx", import.meta.url);
const PICKS = new URL("../picks/MyPicksClient.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/** Source with every comment removed — see picks/pick-sticky-bar.test.ts. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the dues module's shape", () => {
  it("is ONE card with a row per entry, not a card per entry", async () => {
    // The first pass at 0017 stacked one headed card per entry, which repeated
    // the deadline, the how-to-pay and the thank-you inside each. Those are
    // facts about the LEAGUE and the design states them once.
    const src = await code(DUES);
    expect(src).toContain("leagues.map((league, i)");
    // A single AccountSection wrapping a single card.
    expect(src.match(/<AccountSection/g) ?? []).toHaveLength(1);
    expect(src.match(/cn\(CARD,/g) ?? []).toHaveLength(1);
  });

  it("keys the footer off the module state, not off the first entry", async () => {
    // `partial` has to reach How to Pay: one entry settled and one not still
    // owes, and reading `leagues[0].buyInPaid` would thank a player who owes.
    const src = await code(DUES);
    expect(src).toContain("const state = duesState(leagues);");
    expect(src).toContain('state === "paid"');
  });

  /*
   * THE DELIBERATE DEVIATION. The frame's stamp reads "Updated 10/21"; this
   * keeps the clock, because it was added after an admin toggled paid off and
   * on in one afternoon and watched a date that never moved — `formatMonthDay`
   * was deleted for it, and a stamp that cannot show a same-day change is not a
   * stamp. Transcribing the frame here would reintroduce that bug exactly.
   */
  it("keeps the clock on the updated stamp", async () => {
    const src = await code(DUES);
    expect(src).toContain('mode="monthdayclock"');
    expect(src).not.toContain('mode="monthday"');
  });

  it("shows the total owed, not the bare buy-in", async () => {
    // The label is the frame's ("League Buy In") and the number is what you
    // actually owe. They agree whenever the site fee is zero — the row the
    // frame draws — and where a fee exists the breakdown underneath says so,
    // rather than printing a figure a player would underpay by.
    const src = await code(DUES);
    expect(src).toContain("{view.total}");
    expect(src).toContain("{view.breakdown}");
  });
});

describe("where the Add 2nd Entry button lives", () => {
  it("is in the dues module", async () => {
    const src = await code(DUES);
    expect(src).toContain("<AddEntryCta");
    expect(src).toContain("canAddEntry ?");
  });

  /*
   * It had two invented placements while this design was outstanding — a row on
   * the picks page and another in Additional Settings — and the frame put the
   * button below the dues card instead. Both are removed; these two assertions
   * are what stop one drifting back and giving the app three ways to do it.
   */
  it("is nowhere else", async () => {
    expect(await read(MORE)).not.toContain("AddEntryCta");
    expect(await read(PICKS)).not.toContain("AddEntryCta");
  });
});

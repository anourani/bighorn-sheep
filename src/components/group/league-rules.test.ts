import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the League Rules dialog.
 *
 * There is no jsdom here, so nothing renders it. What these pin are the four
 * decisions a later edit would undo in silence — each one looks like an
 * improvement from inside the file and is wrong from outside it.
 */
const MODAL = new URL("./LeagueRulesModal.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/** Source with every comment removed — see picks/pick-sticky-bar.test.ts. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the rules dialog's shape", () => {
  /*
   * The commissioner CARD is gone — avatar, name and a line of copy in a tile
   * at the very top, above the rules themselves. It is one sentence in the prose
   * now. Pinned because re-adding an avatar here is a natural-looking impulse
   * and it would push the rules below the fold again, which is the thing this
   * dialog exists to show.
   */
  it("does not render a commissioner card", async () => {
    const src = await code(MODAL);
    expect(src).not.toContain("<Avatar");
    expect(src).not.toContain("Avatar");
  });

  /*
   * The order: written rules FIRST, the settings grid last. It used to be
   * commissioner → tiles → rules, so the thing a player opened the dialog to
   * read was the last thing in it.
   */
  it("puts the numbered rules above the This-league tiles", async () => {
    const src = await code(MODAL);
    const rules = src.indexOf("<ol");
    const tiles = src.indexOf("This league");
    expect(rules).toBeGreaterThan(-1);
    expect(tiles).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(tiles);
  });

  /*
   * `list-decimal` is load-bearing, not decoration. Tailwind's preflight sets
   * `list-style: none` on every ol and ul, so dropping it renders seven
   * unnumbered paragraphs — which reads as a copy bug and sends the next person
   * looking in the wrong file entirely.
   */
  it("numbers the rules with an ordered list that actually shows markers", async () => {
    const src = await code(MODAL);
    expect(src).toContain("list-decimal");
    expect(src.match(/<li>/g) ?? []).toHaveLength(7);
  });

  /*
   * BOTH DATES ARE DERIVED, and from the two DIFFERENT timestamps that mean two
   * different things: `entryClosesAt` is the first kickoff of Week 1 (the season
   * starts) and `joinClosesAt` is the last (joining stops). The supplied copy
   * named real dates — "Wed, Sept 9, 2026", "Mon, Sept 14, 2026, 8:15 PM ET" —
   * and typing those in would have gone stale next season and, worse, disagreed
   * with the Entry-closes tile a few lines below.
   */
  it("derives every date rather than hardcoding one", async () => {
    const src = await code(MODAL);
    expect(src).toContain("iso={group.entryClosesAt}");
    // Twice: the Season paragraph and the "Entry closes" tile, which is what
    // stops the two contradicting each other on one screen.
    expect(src.match(/iso=\{joinClosesAt\(group\)\}/g) ?? []).toHaveLength(2);
    // No month name or year typed into the markup.
    expect(src).not.toMatch(/\b(Sept?|September|October|November|December)\b/);
    expect(src).not.toMatch(/\b20\d\d\b/);
  });

  /*
   * The seven rules are FIXED COPY, by decision. They assert single elimination
   * and tie-as-loss outright, where the previous version generated those two
   * clauses from `group.rules`. That is a knowing trade — the commissioner's
   * wording reads worse assembled from fragments — and the cost is that changing
   * the league's settings makes rule 1 wrong.
   *
   * Pinned so that re-deriving them is a deliberate act with this comment in
   * front of it, rather than a tidy-up. The tiles below still read the settings,
   * which is why they may name them and the prose may not.
   */
  it("keeps the rules copy fixed rather than generated from group.rules", async () => {
    const src = await code(MODAL);
    const rules = src.slice(src.indexOf("<ol"), src.indexOf("</ol>"));
    expect(rules).not.toContain("group.rules");
    expect(rules).not.toContain("tieRule");
    expect(rules).not.toContain("eliminationType");
    // The tiles, outside that slice, still do.
    expect(src).toContain("group.rules.tieRule");
  });
});

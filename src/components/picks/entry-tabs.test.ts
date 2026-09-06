import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { H5 } from "../../lib/type-scale";

/**
 * Source-text guards for the entry switcher, shaped like
 * `pick-sticky-bar.test.ts` and `group/admin-tabs.test.ts`. There is no jsdom
 * here, so nothing renders `EntryTabs`; what these pin are the decisions that
 * fail SILENTLY — a control that looks right and spends the wrong entry's team,
 * a tablist a keyboard cannot leave, a duplicate id.
 *
 * The limit, stated plainly: reading source cannot catch a typo in a class
 * Tailwind never heard of, and it cannot measure the 60px card. Those are
 * browser checks.
 */
const TABS = new URL("./EntryTabs.tsx", import.meta.url);
const CLIENT = new URL("./MyPicksClient.tsx", import.meta.url);
const BAR = new URL("./PickStickyBar.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/** Source with every comment removed — see pick-sticky-bar.test.ts. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("EntryTabs' contract", () => {
  it("renders nothing below two entries", async () => {
    // Every player has one entry until they take a second, so this is the
    // branch almost everybody takes. A one-tab tablist is noise on screen and
    // in the accessibility tree alike.
    expect(await code(TABS)).toContain("if (tabs.length < 2) return null;");
  });

  it("is a real tablist with a roving tabindex", async () => {
    const src = await code(TABS);
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain("aria-selected={selected}");
    // One tab stop for the row, arrows within it. Without this a two-entry
    // player tabs through both cards to reach the grid.
    expect(src).toContain("tabIndex={selected ? 0 : -1}");
  });

  it("shares the wrapping arrow logic rather than reimplementing it", async () => {
    // `nextTabIndex` wraps, per WAI-ARIA, and is already the keyboard contract
    // for `ui/Tabs`. The week strip's `nextIndex` deliberately CLAMPS instead,
    // so reaching for the wrong one is a real mistake this pins.
    const src = await code(TABS);
    expect(src).toMatch(/import \{[^}]*nextTabIndex[^}]*\} from "@\/components\/ui\/tabs"/s);
    expect(src).not.toContain("nextIndex");
  });

  it("prevents the default arrow scroll", async () => {
    // The row sits directly above the pick grid, so an un-prevented ArrowRight
    // both moves the tab and jumps the viewport away from it.
    expect(await code(TABS)).toContain("e.preventDefault();");
  });

  it("takes the shared H5 step rather than retyping it", async () => {
    // The trap `type-scale.ts` exists for: a hand-typed
    // text-[20px]/font-semibold/leading/tracking quartet drifts from the scale
    // the moment the design moves.
    const src = await code(TABS);
    expect(src).toMatch(/import \{ H5 \} from "@\/lib\/type-scale"/);
    expect(H5).toBe("text-[20px] font-semibold leading-[1.2] tracking-[-0.04em]");
    expect(src).not.toContain("text-[20px] font-semibold");
  });

  it("carries no attention dot", async () => {
    // A decision, not an omission: the design hides the dot, and the card's own
    // "No Pick" is a stronger signal than a dot beside those words.
    const src = await code(TABS);
    expect(src).not.toContain("badge-due");
    expect(src).toContain("No Pick");
  });

  it("keeps the second line a fixed height", async () => {
    // The row must not change height between a card showing a logo and one
    // showing "No Pick" — the same don't-move-under-the-finger rule the tour's
    // art frame keeps, and here the bar's slide distance depends on it too.
    expect(await code(TABS)).toContain("flex h-7 items-center gap-1");
  });
});

describe("the two placements", () => {
  it("uses one component in both, at one size", async () => {
    // The design draws identical 60px cards in flow and in the sticky bar, so
    // there is no compact variant. A second geometry is how the two would drift.
    expect(await code(CLIENT)).toContain("<EntryTabs");
    expect(await code(BAR)).toContain("<EntryTabs");
    expect(await code(TABS)).toContain("h-[60px]");
  });

  it("gives each placement its own panel key", async () => {
    /*
     * Both tablists are in the document at once — the sticky one is merely
     * translated off screen — and `tabId`/`panelId` derive element ids from this
     * key. A shared key would emit duplicate ids for every tab and panel, which
     * is invalid HTML and breaks `aria-controls` resolution for both.
     */
    expect(await code(CLIENT)).toContain('panelKey="picks-entry"');
    expect(await code(BAR)).toContain('panelKey="picks-entry-sticky"');
  });

  it("feeds the sticky bar tabs only when there are two entries", async () => {
    // Below two the bar is exactly what it always was: the condensed pick row,
    // aria-hidden, nothing focusable.
    expect(await code(CLIENT)).toContain("entries.length >= 2");
  });
});

describe("what the switcher scopes", () => {
  it("derives the week's picks from the active entry, not entry 1", async () => {
    // `data.viewerPicks` is entry 1's list and stayed that way on purpose, so
    // reading it here would show entry 1's picks under both tabs — and, worse,
    // compute `usedByTeam` from them, offering a team entry 2 had spent.
    const src = await code(CLIENT);
    expect(src).toContain("regularPicks: activeEntry.picks");
    expect(src).toContain("viewingPractice ? (practiceMe?.picks ?? []) : activeEntry.picks");
  });

  it("keys submit chains by entry as well as week", async () => {
    // Two entries may hold picks for the same week at once. One chain per week
    // would let entry 2's tap settle entry 1's in-flight request and revert to
    // the wrong team.
    const src = await code(CLIENT);
    expect(src).toContain("const queueKey = (entryNo: EntryNo, key: string) => `${entryNo}|${key}`");
    expect(src).toContain("const qKey = queueKey(entryNo, key);");
  });

  it("reads the practice record by membership id", async () => {
    // Practice is keyed by membership id since 0017. Keyed on the person, a
    // two-entry player would see entry 1's practice round under both tabs.
    expect(await code(CLIENT)).toContain("practice?.members[activeEntry.memberId]");
  });

  it("sends the entry with every pick", async () => {
    expect(await code(CLIENT)).toContain(
      "submitPick({ groupId: group.id, teamId, seasonType, week, entryNo })",
    );
  });
});

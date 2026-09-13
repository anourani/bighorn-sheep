import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the admin drawer's tab bar, shaped like
 * `shell/bottom-tab-bar.test.ts` — there is no jsdom here, so nothing renders
 * the drawer, and these check the things about it that fail SILENTLY.
 *
 * The silent failure being guarded is a real one, caught by measuring rather
 * than by review: `Tabs` draws every option `flex-1 whitespace-nowrap px-3`, a
 * flex item's default `min-width: auto` refuses to shrink below its content,
 * and nothing in the drawer may scroll. So a label that is one word too long
 * pushes the bar past the rail — and because the bar is not inside `main`'s
 * clip, the whole document then scrolls sideways at 320px. Nothing errors.
 *
 * Be honest about the limit, as the sibling file is: reading source cannot
 * catch a typo in a class Tailwind never heard of, and the widths themselves
 * are browser measurements. What these pin is that the two escape hatches are
 * still present and the cap has not been trimmed back.
 */
const read = (url: URL) => readFile(url, "utf8");

/**
 * Source with comments stripped, the helper `header-nav.test.ts` uses. Without
 * it these can pass for the wrong reason — the docblock above `TABS` names
 * every one of these strings while explaining them.
 */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const DRAWER = new URL("./AdminSettingsDrawer.tsx", import.meta.url);

describe("the admin drawer's tabs", () => {
  it("carries exactly the five the drawer renders", async () => {
    const src = await code(DRAWER);
    for (const value of ["members", "picks", "league", "feed", "emails"]) {
      expect(src, `TABS should still declare ${value}`).toContain(`value: "${value}"`);
    }
    // Rules and Name merged into League Settings; a stray branch for either
    // would render nothing, because TabValue no longer has the value.
    expect(src).not.toContain('value: "rules"');
    expect(src).not.toContain('value: "name"');
  });

  /**
   * COUNTED, not merely present. The original of this test asserted only that
   * each value appeared, so adding Picks left it green while it quietly stopped
   * describing the bar — and the width budget below is a function of how many
   * tabs there are, so a sixth added without thought is exactly the change that
   * must not pass silently.
   */
  it("declares five and no more, because the width budget is per tab", async () => {
    const src = await code(DRAWER);
    const tabs = src.slice(src.indexOf("const TABS"), src.indexOf("];", src.indexOf("const TABS")));
    expect(tabs.match(/value: "/g) ?? []).toHaveLength(5);
  });

  /**
   * Three labels overflow a phone once there are five tabs. Measured at 320 with
   * four: "League Settings" wants 125.2 and "Data Feed" 89.4, against 72px per
   * tab. A fifth tab drops the share to ~56, which "Members" (82.4 intrinsic)
   * no longer clears either — hence the third pair.
   *
   * `Tabs` now carries `min-w-0 truncate`, so a missed pair degrades to an
   * ellipsis rather than to a document that scrolls sideways. These stay
   * regardless: an ellipsis on a five-letter word is still a bug, just a quiet
   * one, and the backstop is not the plan.
   */
  it("keeps a short label below lg for each of the long ones", async () => {
    const src = await code(DRAWER);
    for (const [short, long] of [
      ["Roster", "Members"],
      ["League", "League Settings"],
      ["Feed", "Data Feed"],
      ["Mail", "Emails"],
    ]) {
      expect(src, `${long} needs a phone-width fallback`).toContain(
        `<span className="lg:hidden">${short}</span>`,
      );
      expect(src).toContain(`<span className="hidden lg:inline">${long}</span>`);
    }
  });

  /**
   * `display: none` at the off width, so exactly one of each pair is in the
   * accessibility tree. An `sr-only` sibling would be read out ALONGSIDE the
   * visible label rather than replacing it — the same rule the two `Primary`
   * navs rely on.
   */
  it("hides the off-width half with display, never sr-only", async () => {
    const src = await code(DRAWER);
    const labels = src.slice(src.indexOf("const TABS"), src.indexOf("];", src.indexOf("const TABS")));
    expect(labels).not.toContain("sr-only");
  });

  /**
   * The cap has to clear the widest LABEL, not a per-tab average — and it is a
   * function of the TAB COUNT, which is why adding Picks moved it.
   *
   * Measured in Chromium with the real self-hosted Inter, at `px-3`:
   * "League Settings" is 113.8 intrinsic, the widest of the five. Each tab gets
   * (cap - 8) / 5, the 8 being the track's `p-1`:
   *
   *   cap 560 → 110.4  (-3.4, would clip)
   *   cap 620 → 122.4  (+8.6)
   *   cap 700 → 138.4  (+24.6)
   *
   * So 620 would NOT have broken — it would have left 8.6px, which is exactly
   * the margin the four-tab note above already called uncomfortable ("eight
   * pixels against a font that renders differently in Figma than in Chromium"),
   * and which a sixth tab or one longer label would erase. 700 is the same
   * decision 560 → 620 was, made once rather than twice.
   */
  it("caps the bar wide enough for the longest label from lg", async () => {
    const src = await code(DRAWER);
    const match = /lg:max-w-\[(\d+)px\]/.exec(src);
    expect(match, "the Tabs cap should still be an explicit px value").not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(680);
  });

  /**
   * Three lock behaviours share the League Settings tab now — the rules freeze
   * when the season starts, while `set_group_buy_in` and `set_group_name`
   * deliberately have no lock check at all. A tab-level glyph would be a claim
   * about the tab that is false for three of its four sections.
   */
  it("puts no lock affordance on the tab bar", async () => {
    const src = await code(DRAWER);
    const tabs = src.slice(src.indexOf("const TABS"), src.indexOf("];", src.indexOf("const TABS")));
    expect(tabs).not.toContain("LockIcon");
  });
});

describe("the drawer's one-scroller rule", () => {
  /**
   * `Drawer`'s body is the only scroller in the tree, so a short tab does not
   * scroll and a long one scrolls as one panel. A thirty-row reminder list is
   * exactly what tempts a `max-h` — which is why this is worth a test rather
   * than a comment.
   */
  it("adds no max-height or overflow inside any panel", async () => {
    const src = await code(DRAWER);
    expect(src).not.toMatch(/\bmax-h-/);
    expect(src).not.toMatch(/\boverflow-(y|x)?-?(auto|scroll)\b/);
  });
});

describe("the Members roster's grid", () => {
  /**
   * The column headers and the rows are TWO ELEMENTS, not a `<table>`, so
   * nothing structural keeps their tracks in step. Add a track to one and not
   * the other and every header label sits over the wrong control — with no
   * error, no failing type and nothing visibly broken below `lg`, where the
   * header is `hidden` and the row stacks. Both strings must stay identical.
   */
  it("declares the same six tracks on the header and on the row", async () => {
    const src = await code(DRAWER);
    const templates = src.match(/lg:grid-cols-\[[^\]]+\]/g) ?? [];
    const roster = templates.filter((t) => t.includes("72px"));
    expect(roster).toHaveLength(2);
    expect(roster[0]).toBe(roster[1]);
    // Number · member · status pill · Paid · Preseason · Remove.
    expect(roster[0]).toBe("lg:grid-cols-[32px_minmax(0,1fr)_72px_168px_200px_88px]");
  });

  /**
   * Six tracks need six cells. The header spaces the number, the status pill
   * and the Remove column with bare `<span />`s, so a dropped one shifts every
   * label after it one column left.
   */
  it("gives the header a cell for all six", async () => {
    const src = await code(DRAWER);
    const header = src.slice(src.indexOf('lg:grid-cols-[32px'), src.indexOf("</ul>"));
    const cells = header.slice(0, header.indexOf("</div>"));
    expect(cells.match(/<span \/>/g) ?? []).toHaveLength(3);
    for (const label of ["Member", "Paid", "Preseason"]) {
      expect(cells).toContain(`>${label}<`);
    }
  });

  /**
   * The roster is sorted for display and the row number is its index, so the
   * two have to come off the same array — numbering an unsorted list, or
   * numbering `members` while rendering `roster`, both produce a list whose
   * numerals do not run 1..N in order.
   */
  it("numbers the sorted array rather than the raw prop", async () => {
    const src = await code(DRAWER);
    expect(src).toContain("const roster = useMemo(() => sortRosterByName(members), [members])");
    expect(src).toContain("{roster.map((m, i) => {");
    expect(src).not.toContain("{members.map(");
  });

  /**
   * The one screen that administers real people shows the whole name. The two
   * switches and the Remove button label themselves with the SAME string, so
   * the accessible name never disagrees with the visible one.
   *
   * Since 0017 that string is `rowName`, which is the full name plus "(Entry 2)"
   * on a second entry. The roster is one row per ENTRY, so two rows can carry
   * the same name — and three controls labelled "Buy-in paid — Ali B." with no
   * way to tell which entry they touch is exactly the ambiguity this test was
   * written to prevent, one level down.
   */
  it("renders the full name and labels the whole row with it", async () => {
    const src = await code(DRAWER);
    expect(src).toContain("const fullName = formatFullName(m.firstName, m.lastName)");
    expect(src).toContain("{fullName}</span>");
    expect(src).toContain("a11y={`Buy-in paid — ${rowName}`}");
    expect(src).toContain("a11y={`Show preseason weeks — ${rowName}`}");
    // RemoveControl takes the row's name rather than re-deriving an
    // abbreviation, which is how the two would drift apart.
    expect(src).not.toContain("member.name");
  });

  it("distinguishes a second entry in both the label and the badge", async () => {
    const src = await code(DRAWER);
    // The suffix is derived once, beside the name, so the three controls cannot
    // disagree about which entry they administer.
    expect(src).toMatch(/const rowName = m\.entryNo === 2 \? `\$\{fullName\} \(Entry 2\)` : fullName/);
    expect(src).toContain("{m.entryNo === 2 ? (");
  });

  /**
   * The roster's writes address a row by (group, user, entry) — the arguments
   * the RPCs take — while its React state keys on the membership id. Passing
   * `m.id` where a user id belongs would raise `member_not_found` for every
   * action on the tab, so it is worth a source guard.
   */
  it("sends the user id and entry to the member RPCs, never the membership id", async () => {
    const src = await code(DRAWER);
    expect(src).not.toMatch(/userId: m\.id/);
    expect(src).toContain("removeMember({ groupId, userId: m.userId, entryNo: m.entryNo })");
    expect(src).toContain("setMemberBuyIn({ groupId, userId: m.userId, paid: next, entryNo: m.entryNo })");
    expect(src).toContain(
      "setMemberPreseason({ groupId, userId: m.userId, show: next, entryNo: m.entryNo })",
    );
    // The optimistic overlays and pending keys stay on the membership id, which
    // is what makes them per-entry.
    expect(src).toContain("paidOverrides[m.id]");
    expect(src).toContain("`${m.id}:remove`");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the admin drawer's Picks tab, shaped like its sibling
 * `admin-tabs.test.ts` — there is no jsdom here, so nothing renders the drawer,
 * and these pin the things about it that fail SILENTLY.
 *
 * The rules worth testing this way are the ones where being wrong looks fine:
 * a control that says "No pick" over a pick nobody can see, a select that offers
 * a team on a bye, an RPC called with the wrong id. All three typecheck.
 *
 * Be honest about the limit, as the sibling is: reading source cannot catch a
 * class Tailwind never heard of, and it cannot prove the component renders. What
 * it pins is that the load-bearing strings are still there.
 */
const read = (url: URL) => readFile(url, "utf8");

/** Source with comments stripped — the docblocks below name these strings. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const DRAWER = new URL("./AdminSettingsDrawer.tsx", import.meta.url);
const TABS = new URL("../ui/Tabs.tsx", import.meta.url);

/** Just the PicksSection body, so a match in MembersSection can't stand in. */
async function picksSection(): Promise<string> {
  const src = await code(DRAWER);
  const start = src.indexOf("function PicksSection(");
  expect(start, "PicksSection should still be in the drawer beside its siblings").toBeGreaterThan(0);
  return src.slice(start, src.indexOf("function PickCell(", start));
}

describe("the Picks tab's writes", () => {
  /**
   * Since 0017 `Member.id` is the MEMBERSHIP id — the right key for this
   * component's own overlay and pending maps, and the wrong argument for an RPC
   * that locates a row by (group, user, entry). Passing `m.id` would raise
   * `member_not_found` for every save on the tab. The roster has the same test
   * one section over, which is how that regression was caught there.
   */
  it("sends the user id and entry to admin_set_pick, never the membership id", async () => {
    const section = await picksSection();
    expect(section).not.toMatch(/userId: m\.id/);
    expect(section).toContain("userId: m.userId");
    expect(section).toContain("entryNo: m.entryNo");
    // The overlay and the pending keys stay on the membership id, which is what
    // makes them per-ENTRY rather than per-person.
    expect(section).toContain("overrides[m.id]");
    expect(section).toContain("`${m.id}:pick`");
  });

  /**
   * The one write path. A `.update()` on `picks` from the browser is refused by
   * RLS for another member's row and silently changes nothing — the same failure
   * `group_members` has, which is why every admin verb here is an RPC.
   */
  it("goes through the server action rather than touching picks directly", async () => {
    const section = await picksSection();
    expect(section).toContain("setPickForMember({");
    expect(section).not.toContain('from("picks")');
  });

  /**
   * A tab left open across a deploy posts a Server Action id the running server
   * has never heard of. Every call site in the app handles it; this one cannot
   * use `runAction` because it needs the payload back (`rescored`), so it has to
   * carry the pair itself.
   */
  it("handles deploy skew on its own, since it reads the action's payload", async () => {
    const section = await picksSection();
    expect(section).toContain("isStaleDeploymentError(err)");
    expect(section).toContain("reloadOnce()");
  });
});

describe("the Picks tab's reads", () => {
  /**
   * THE OVERWRITE-BLIND REGRESSION, at the component level. In the live week a
   * member who picked a 4pm game reaches the client with no readable pick —
   * identical to one who has not picked. `viewPickForWeek` tells them apart from
   * `hiddenPickMemberIds`, and both halves of the answer have to land: a lock
   * that LOOKS locked while the control still writes is worse than neither.
   */
  it("draws a lock for a hidden pick and disables the control", async () => {
    const src = await code(DRAWER);
    const section = await picksSection();
    expect(section).toContain("viewPickForWeek({");
    expect(section).toContain("canAdminEditPick(view, week, started)");
    expect(section).toContain("disabled={!editable || busy}");
    // The lock itself lives in PickCell, the read half of the row.
    const cell = src.slice(src.indexOf("function PickCell("));
    expect(cell).toContain('view.kind === "hidden"');
    expect(cell).toContain("<LockIcon");
  });

  /**
   * The same regression one step further. An eliminated entry keeps picking for
   * the weeks after it went out, and 0020 hides those rows from the admin's
   * reads — so without its own branch the row would read "No pick" over a pick
   * that exists. `canAdminEditPick` disables the control for `out`; this pins
   * that the cell says so rather than drawing the blank.
   */
  it("draws an eliminated entry's later weeks as Out, not as No pick", async () => {
    const src = await code(DRAWER);
    const cell = src.slice(src.indexOf("function PickCell("));
    expect(cell).toContain('view.kind === "out"');
    expect(cell).toContain("Out since Week");
    // The out branch has to run BEFORE the "No pick" fallback, or it is dead.
    expect(cell.indexOf('view.kind === "out"')).toBeLessThan(cell.indexOf("shown === null"));
    expect(src).toContain("member_eliminated:");
  });

  /**
   * Options come from the WEEK's teams, never from `TEAMS` wholesale. A team on
   * a bye is not in that week's games, so offering all 32 would let the UI make
   * a choice the RPC answers `no_game_for_team` for — the standing rule that a
   * button must never offer what the function behind it refuses.
   */
  it("offers only the teams playing that week", async () => {
    const section = await picksSection();
    expect(section).toContain("data.teamsByWeek[week]");
    expect(section).toContain("teams.map((teamId)");
    expect(section).not.toMatch(/\bTEAMS\.map\b/);
  });

  /**
   * The roster is sorted for display and the row number is its index, so the two
   * have to come off the same array — and the membership query behind `members`
   * has no `.order(...)`, so heap order can change after any UPDATE. This tab
   * writes, so an unsorted list could reshuffle under the admin who just saved.
   */
  it("numbers the sorted array rather than the raw prop", async () => {
    const section = await picksSection();
    expect(section).toContain("sortRosterByName(members)");
    expect(section).toContain("roster.map((m, i) => {");
    expect(section).not.toContain("{members.map(");
  });

  /**
   * Two rows carry the same name when a player holds two entries, so every
   * string that has to tell them apart is suffixed — the roster's rule, one tab
   * over, and the select's accessible name is exactly where it matters.
   */
  it("distinguishes a second entry in the control's accessible name", async () => {
    const section = await picksSection();
    expect(section).toMatch(/const rowName = m\.entryNo === 2 \? `\$\{fullName\} \(Entry 2\)` : fullName/);
    expect(section).toContain("aria-label={`Week ${week} pick — ${rowName}`}");
  });
});

describe("the Picks tab's layout", () => {
  /**
   * The drawer's body is the one scroller in the tree. A thirty-row list of
   * selects is exactly what tempts a `max-h-96` — which is why the sibling file
   * tests the whole drawer for it and this one says so again for the section
   * that most invites it.
   */
  it("adds no max-height or overflow of its own", async () => {
    const section = await picksSection();
    expect(section).not.toMatch(/\bmax-h-/);
    expect(section).not.toMatch(/\boverflow-(y|x)?-?(auto|scroll)\b/);
  });

  /**
   * `admin-tabs.test.ts` finds the ROSTER's two grid templates by filtering every
   * `lg:grid-cols-[…]` in the file on the substring `72px`, and asserts exactly
   * two exist and match. A `72px` track anywhere in this section would join that
   * filter and fail a test about a grid it has nothing to do with — a confusing
   * failure a long way from its cause, so it is worth saying out loud here.
   */
  it("keeps 72px out of its own tracks, so the roster's guard stays about the roster", async () => {
    const section = await picksSection();
    const templates = section.match(/lg:grid-cols-\[[^\]]+\]/g) ?? [];
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) expect(t).not.toContain("72px");
    // Header and row must still declare the SAME tracks: they are two elements,
    // not a <table>, so nothing structural keeps them in step.
    expect(new Set(templates).size).toBe(1);
    expect(templates).toHaveLength(2);
  });
});

describe("the tab bar's overflow backstop", () => {
  /**
   * A flex item's default `min-width: auto` refuses to shrink below its content,
   * which is why a fifth tab could push the bar past its container — and because
   * the admin drawer renders `Tabs` in `Drawer`'s header, a sibling of the page
   * rather than something inside `main`'s clip, that overflow reached the
   * DOCUMENT and scrolled the page sideways at 320px.
   *
   * `min-w-0` disables the floor so items shrink; `truncate` clips what is left.
   * Both are one word and either one alone leaves the bug. Note `truncate` is
   * `overflow: hidden` — NOT `overflow-x-auto` — so the drawer's one-scroller
   * rule is untouched, and the sibling file's `auto|scroll` regex does not match.
   *
   * A source test cannot measure, and does not pretend to: the widths are a
   * browser measurement and live in the `TABS` docblock.
   */
  it("keeps min-w-0 and truncate on the tab button", async () => {
    const src = await code(TABS);
    expect(src).toContain("min-w-0");
    expect(src).toContain("truncate");
    expect(src).not.toMatch(/\boverflow-x-(auto|scroll)\b/);
  });

  /**
   * `px-1 lg:px-3` is what keeps the ellipsis UNUSED at five tabs, so it is
   * load-bearing despite looking like a taste decision — and below `lg` it costs
   * nothing visible, because `flex-1` gives every tab the same rendered width
   * whatever its padding. Padding there decides only the INTRINSIC width, i.e.
   * when a label starts truncating.
   *
   * Measured at 320, bar 273, each tab 53: `px-3` clips four of the five short
   * labels, `px-2` leaves "Roster" 0.4px of margin, `px-1` leaves 3.8. Stepping
   * this back up is a silent regression — the bar still will not overflow, it
   * will just start saying "Leagu…".
   */
  it("keeps the phone-width padding that stops the labels clipping", async () => {
    const src = await code(TABS);
    expect(src).toMatch(/\bpx-1\b/);
    expect(src).toContain("lg:px-3");
    expect(src).not.toMatch(/"[^"]*\bpx-3 [^"]*lg:px-3/);
  });
});

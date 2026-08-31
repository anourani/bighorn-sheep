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
  it("carries exactly the four the drawer renders", async () => {
    const src = await code(DRAWER);
    for (const value of ["members", "league", "feed", "emails"]) {
      expect(src, `TABS should still declare ${value}`).toContain(`value: "${value}"`);
    }
    // Rules and Name merged into League Settings; a stray branch for either
    // would render nothing, because TabValue no longer has the value.
    expect(src).not.toContain('value: "rules"');
    expect(src).not.toContain('value: "name"');
  });

  /**
   * Both long labels overflow a phone. Measured at 320: "League Settings" wants
   * 125.2 and "Data Feed" 89.4, against 72px per tab across four.
   */
  it("keeps a short label below lg for both of the long ones", async () => {
    const src = await code(DRAWER);
    for (const [short, long] of [
      ["League", "League Settings"],
      ["Feed", "Data Feed"],
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
   * The cap has to clear the widest LABEL, not a per-tab average. At 540 each
   * tab is 133 against "League Settings"'s 125.2 intrinsic — eight pixels of
   * margin against a font that renders differently in Figma than in Chromium.
   */
  it("caps the bar wide enough for the longest label from lg", async () => {
    const src = await code(DRAWER);
    const match = /lg:max-w-\[(\d+)px\]/.exec(src);
    expect(match, "the Tabs cap should still be an explicit px value").not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(600);
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

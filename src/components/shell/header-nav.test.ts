import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the desktop header, shaped like
 * `bottom-tab-bar.test.ts` next door. There is no jsdom here, so nothing renders
 * `AppHeader` or `HeaderNav` — and until now neither had any test at all, even
 * though both of the failure modes that suite was written for apply to them: a
 * class the JIT cannot resolve compiles to *nothing*, and a renamed token
 * vanishes without a word.
 *
 * The limit, stated plainly: reading source for a string cannot catch a typo in
 * a class Tailwind never heard of. The pill's 397 × 58, the 70px row, the three
 * inks and the `lg` hide are browser measurements and are not testable here.
 */
const NAV = new URL("./HeaderNav.tsx", import.meta.url);
const HEADER = new URL("./AppHeader.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/**
 * Source with every comment removed. The assertions below are about what these
 * files DO, and a docblock explaining why a class is deliberately absent would
 * otherwise fail the test that checks it is absent.
 */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the header pill's surface", () => {
  it("carries the design's border and shadow as resolvable classes", async () => {
    // Arbitrary values are where the JIT fails silently: an unparseable one
    // compiles to nothing and the pill loses its edge with no error anywhere.
    const src = await code(NAV);
    expect(src).toContain("border-shell-line/50");
    expect(src).toContain("shadow-[0_6px_6px_rgba(0,0,0,0.08)]");
  });

  it("is opaque, and ships no blur that could not show through it", async () => {
    // Figma puts a 4px backdrop blur on an opaque white fill, where it cannot
    // do anything. Shipping it would be dead CSS; this pins the decision.
    const src = await code(NAV);
    expect(src).toContain("bg-white");
    expect(src).not.toContain("backdrop-blur");
  });

  it("keeps the unpaid dot's overhang unclipped", async () => {
    // Standing rule: nothing in a notification dot's subtree may take
    // `overflow-hidden`.
    expect(await code(NAV)).not.toContain("overflow-hidden");
  });
});

describe("the header pill's accessibility", () => {
  it("names the unpaid state in the link rather than the badge", async () => {
    const src = await code(NAV);
    expect(src).toContain("aria-hidden");
    expect(src).toContain('"Account — buy-in unpaid"');
    // The visible "Account" must stay a substring of that name — WCAG 2.5.3
    // Label in Name. `nav.test.ts` pins the label's casing for the same reason.
    expect(src).toContain("aria-current");
  });

  it("declares exactly one Primary landmark", async () => {
    // Two would be a real problem; it is legal only because this one and
    // `BottomTabBar`'s are hidden from each other by `display: none`.
    const matches = (await code(NAV)).match(/aria-label="Primary"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("AppHeader's wrapper contract", () => {
  it("stays sticky, in the app-chrome tier, and desktop-only", async () => {
    // The `lg` boundary is load-bearing beyond this file: `BottomTabBar` and
    // `PickStickyBar` are both `lg:hidden` and assume this owns the top edge
    // from `lg` up and nothing owns it below.
    const src = await code(HEADER);
    expect(src).toContain("sticky top-0 z-30");
    expect(src).toContain("lg:block");
  });

  it("no longer fills the full width behind the pill", async () => {
    // The bar used to be `bg-bg/[0.12] backdrop-blur-sm`. The pill carries its
    // own fill now and the gutters are transparent, so content scrolls through
    // them — if this fill comes back, that reading is gone.
    const src = await code(HEADER);
    expect(src).not.toContain("bg-bg/");
    expect(src).not.toContain("backdrop-blur");
  });
});

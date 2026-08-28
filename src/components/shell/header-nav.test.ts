import { existsSync } from "node:fs";
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

describe("the header pill's tokens and geometry", () => {
  it("takes the selected fill from a token that exists at the expected hex", async () => {
    // The frame says #F5F5F5 — Figma's Simple Design System hover token, which
    // has no home in this palette. `fill-soft` is 2/255 away. A renamed token
    // compiles to nothing and the selected state silently disappears, which
    // reads as a design opinion rather than a bug.
    const config = await readFile(new URL("../../../tailwind.config.ts", import.meta.url), "utf8");
    expect(config).toContain('soft: "#F3F3F3"');
    expect(await code(NAV)).toContain("bg-fill-soft");
  });

  it("keeps the buttons on a minimum width rather than their text width", async () => {
    // Another arbitrary value whose failure looks deliberate: without it the
    // buttons collapse to their labels and the pill measures ~360 against 397.
    expect(await code(NAV)).toContain("min-w-[100px]");
  });

  it("lets clicks through the transparent band beside the pill", async () => {
    // Beyond the design and easy to tidy away by mistake. The header spans the
    // full 1000px shell while only its middle ~400px is drawn, so without the
    // pair it swallows clicks across ~600px of what looks like ordinary page
    // content. The opt-out must be on the <header> itself — a parent still
    // receives what its `none` child declines, which a browser measurement
    // caught after the first attempt put it one level too deep.
    expect(await code(HEADER)).toContain("pointer-events-none");
    expect(await code(NAV)).toContain("pointer-events-auto");
  });
});

describe("the header's app mark", () => {
  const SRC = "/icons/app-mark.jpg";

  it("is served from /icons/, the only path the service worker caches", () => {
    expect(SRC.startsWith("/icons/")).toBe(true);
  });

  it("points at a file that actually exists in public/", () => {
    // A 404 degrades to the `bg-shell-line` grey circle and nothing in the
    // browser says a word — and this mark is now the ONLY place the app
    // identifies itself in the signed-in desktop chrome.
    expect(existsSync(new URL(`../../../public${SRC}`, import.meta.url))).toBe(true);
  });

  it("is referenced by HeaderNav at exactly this path", async () => {
    expect(await code(NAV)).toContain(SRC);
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

  it("keeps the mark's link out of the navigation landmark", async () => {
    // The mark points at /app and so does the Picks button. Two links to one
    // destination inside a single landmark — one `aria-current="page"`, one not
    // — reads worse than the visual duplication, and the old header did not have
    // it. The <nav> must open AFTER the mark's link closes.
    const src = await code(NAV);
    expect(src.indexOf("</Link>")).toBeLessThan(src.indexOf('<nav aria-label="Primary"'));
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

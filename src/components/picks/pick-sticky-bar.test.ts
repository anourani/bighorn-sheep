import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { H3, H4 } from "../../lib/type-scale";

/**
 * Source-text guards for the sticky pick bar, shaped like
 * `shell/bottom-tab-bar.test.ts` and `group/invite-asset.test.ts`. There is no
 * jsdom here, so nothing renders `PickStickyBar`; what these pin are the things
 * about it that fail *silently* — where the symptom is a bar in the wrong place,
 * a logo drawn 7px off centre, or a WCAG violation, and nothing errors.
 *
 * The limit, stated plainly: reading source for a string cannot catch a typo in
 * a class Tailwind never heard of. The trigger point, the slide, the 89px
 * height, the strip and logo geometry, and whether the observer fires at all are
 * all browser measurements.
 */
const BAR = new URL("./PickStickyBar.tsx", import.meta.url);
const CLIENT = new URL("./MyPicksClient.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/**
 * Source with every comment removed. The assertions below are about what the
 * component DOES, and a docblock explaining why a class is not used would
 * otherwise fail the test that checks it is not used.
 */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("PickStickyBar's positioning", () => {
  it("portals to document.body", async () => {
    // Two hazards at once, both silent. `.stagger > *` would hand a fixed root
    // `reveal-up` at up to a 385ms delay — invisible through its own slide. And
    // that animation's `both` fill-mode RETAINS `transform: translateY(0)`
    // forever, which makes every direct child a containing block for
    // `position: fixed`, pinning the bar to a page block instead of the viewport.
    const src = await read(BAR);
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
  });

  it("is mobile-only and sits in the app-chrome tier, never over a dialog", async () => {
    const src = await code(BAR);
    expect(src).toContain("lg:hidden");
    expect(src).toContain("z-30");
    // The overlay tier is z-50 — the bar must pass UNDER a Drawer/Modal scrim.
    expect(src).not.toContain("z-50");
  });

  it("clears the status bar in an installed PWA", async () => {
    // Portalled to body, so it inherits nothing from the shell's own inset
    // padding. Resolves to 0 in every browser, so this is invisible outside a
    // standalone install — exactly the kind of thing that ships broken.
    expect(await read(BAR)).toContain("pt-[env(safe-area-inset-top)]");
  });
});

describe("PickStickyBar's logo", () => {
  it("keeps w-max on the absolutely-positioned wrapper", async () => {
    // The wrapper is absolutely positioned with a `left` and no width, so
    // without a definite width it shrink-to-fits to 22px and a 36px logo draws
    // 22 wide, 11px off centre and overhanging. Nothing errors; it reads as a
    // design slip, which is how this repo shipped the same bug once already.
    //
    // Measured caveat, so this test is not read as more than it is: `w-max` and
    // `TeamLogo`'s own `max-w-none` are redundant — either alone is sufficient,
    // and only removing both reproduces the squash. This pins the belt while
    // the braces live in `TeamLogo`.
    expect(await read(BAR)).toContain("w-max");
  });

  it("reaches for one shared colour ramp rather than retyping a gradient", async () => {
    expect(await read(BAR)).toMatch(/import \{[^}]*stripGradient[^}]*\} from "\.\/pick-hero"/s);
  });
});

describe("PickStickyBar's accessibility", () => {
  it("is aria-hidden and has nothing focusable in it", async () => {
    // The pair is the point: aria-hidden is legal ONLY because nothing inside
    // can take focus. Making the bar tappable must fail a test rather than
    // quietly create a keyboard trap no screen reader can name.
    const src = await read(BAR);
    expect(src).toContain("aria-hidden");
    const markup = (await code(BAR)).slice((await code(BAR)).indexOf("return createPortal"));
    expect(markup).not.toMatch(/<button|onClick|tabIndex|<a\b/);
  });

  it("does not restate the hero's heading as a heading", async () => {
    // A duplicate of PickHero's <h1> would corrupt heading-jump navigation the
    // moment the aria-hidden above ever came off.
    expect(await code(BAR)).not.toMatch(/<h[1-6]\b/);
  });
});

describe("the sticky bar's wiring", () => {
  it("carries no key, so a tap cannot replay its slide", async () => {
    expect(await read(CLIENT)).toMatch(/<PickStickyBar(?![^>]*\bkey=)/);
  });

  it("is fed the SHORT week label, where the hero gets the long one", async () => {
    const src = await read(CLIENT);
    expect(src).toMatch(/<PickStickyBar[^>]*weekName=\{viewShortName\}/s);
    expect(src).toMatch(/<PickHero[^>]*weekName=\{viewName\}/s);
  });
});

describe("H4", () => {
  // The bar's team name. If `letterSpacing` ever reads `normal` in the browser,
  // this constant did not compile.
  it("is H3's step one size down, and differs in nothing else", () => {
    expect(H4).toBe(H3.replace("[32px]", "[24px]"));
  });

  it("carries no colour, so callers can paint it", () => {
    expect(H4).not.toMatch(/text-(shell|ink|brand|accent)/);
  });
});

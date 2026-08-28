import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the mobile tab bar, shaped like
 * `group/invite-asset.test.ts` — there is no jsdom here, so nothing renders
 * `BottomTabBar`, and these check the two things about it that fail *silently*
 * rather than loudly.
 *
 * Be honest about the limit: reading source for a string cannot catch a typo in
 * a class Tailwind never heard of, because the regex is not looking for it.
 * Sticking, the `lg` hide, the dot's position and the toast's clearance are all
 * browser measurements and are not testable here.
 */
const read = (url: URL) => readFile(url, "utf8");

/**
 * Source with every comment removed, the same helper `header-nav.test.ts` uses.
 * Without it these assertions can pass for the wrong reason: a class named only
 * in a docblock explaining why it is no longer used would satisfy a `toContain`
 * that is meant to check the code still uses it.
 */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const BAR = new URL("./BottomTabBar.tsx", import.meta.url);
const CONFIG = new URL("../../../tailwind.config.ts", import.meta.url);
const CSS = new URL("../../app/globals.css", import.meta.url);
const TOAST = new URL("../ui/Toast.tsx", import.meta.url);
const NAV = new URL("./HeaderNav.tsx", import.meta.url);

describe("the tab bar's selected-tab token", () => {
  it("is defined in the Tailwind config at the design's hex", async () => {
    expect(
      await read(CONFIG),
      "colors.fill.soft is the neutral this repo uses where Figma's frame says " +
        "#F5F5F5 — its Simple Design System hover token, 2/255 away.",
    ).toContain('soft: "#F3F3F3"');
  });

  it("is the token the bar actually reaches for, and the one the header uses", async () => {
    // The JIT compiles a class it cannot resolve to *nothing*. A renamed token
    // leaves the selected tab with no fill at all, which reads as a design
    // opinion rather than a bug — the failure mode CLAUDE.md keeps flagging.
    // Both navs must name the same one: they are the same pill now.
    expect(await code(BAR)).toContain("bg-fill-soft");
    expect(await code(NAV)).toContain("bg-fill-soft");
  });
});

describe("the tab bar's surface", () => {
  it("is the header's card, not the frosted track it replaced", async () => {
    const src = await code(BAR);
    expect(src).toContain("bg-white");
    expect(src).toContain("border-shell-line/50");
    expect(src).toContain("shadow-[0_6px_6px_rgba(0,0,0,0.08)]");
    // The frost is gone; a leftover blur would fight the opaque fill.
    expect(src).not.toContain("backdrop-blur");
    expect(src).not.toContain("bg-bg/");
  });

  it("hugs its content rather than stretching", async () => {
    // `shrink-0` is what stops the pill reaching both edges on a large phone or
    // a tablet — the thing the old full-width track got worst, drawing three
    // 325px tabs at 1023px.
    expect(await code(BAR)).toContain("shrink-0");
  });

  it("keeps the unpaid dot's overhang unclipped", async () => {
    expect(await code(BAR)).not.toContain("overflow-hidden");
  });

  it("holds the frame's button box only where it fits", async () => {
    // Below 375px the 100px minimum plus 16px padding overflows a 360px
    // viewport by a rounding error and a 320px one by 40px.
    const src = await code(BAR);
    expect(src).toContain("min-[375px]:min-w-[100px]");
    expect(src).toContain("min-[375px]:px-4");
  });

  it("reaches the 44px tap floor without moving the drawn box", async () => {
    // 40px drawn + 2px each way. `inset-x-0` and not a full `-inset`: the
    // buttons are adjacent with no gap, so a horizontal extension would steal
    // its neighbour's taps. Unlike the header, which is pointer-driven and
    // deliberately does without.
    expect(await code(BAR)).toContain("after:-inset-y-0.5");
    expect(await code(BAR)).toContain("after:inset-x-0");
  });

  it("stays mobile-only and pinned", async () => {
    const src = await code(BAR);
    expect(src).toContain("lg:hidden");
    expect(src).toContain("sticky bottom-0 z-30");
  });
});

describe("the tab bar's height", () => {
  it("is declared once, in globals.css", async () => {
    expect(
      await read(CSS),
      "--tab-bar-h is 4 + 58 + 8, off the Figma frame. It lives on :root because " +
        "Toast portals to document.body and inherits nothing from the app shell.",
    ).toContain("--tab-bar-h: 70px");
  });

  it("is read, not retyped, by both consumers", async () => {
    // The drift this exists to stop: someone hardcodes `bottom-[88px]` on the
    // toast, the bar's height later changes, and the toast quietly overlaps it.
    expect(await code(BAR)).toContain("h-[var(--tab-bar-h)]");
    expect(await read(TOAST)).toContain("var(--tab-bar-h)");
  });

  it("keeps the toast's offset a valid calc()", async () => {
    // Tailwind turns `_` into a space and CSS calc needs whitespace around the
    // `+`. Written with spaces the class breaks at the space; written with
    // neither the value is invalid CSS. Either way it compiles to nothing and
    // presents as "the toast didn't move".
    expect(await read(TOAST)).toContain("bottom-[calc(1.5rem_+_var(--tab-bar-h))]");
  });
});

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

  it("swallows taps where the header passes them through", async () => {
    // The header takes `pointer-events-none` because its undrawn band is
    // ~600px of plainly live content. This bar's is ~28px at the bottom edge
    // where a thumb rests, and a fall-through on the picks page spends a team
    // for the season — so it swallows. Beyond the design and the INVERSE of the
    // header's call, which makes it exactly the kind of thing a reader who knows
    // the header would "correct".
    expect(await code(BAR)).not.toContain("pointer-events");
  });

  it("inverts the header's vertical row padding", async () => {
    // 4px above the pill and 8px below, against the header's 8/4. A 4px
    // difference between two files that are otherwise the same pill is the most
    // likely silent copy error in this whole component.
    const src = await code(BAR);
    expect(src).toContain("pb-2 pt-1");
    expect(await code(NAV)).toContain("pb-1 pt-2");
  });

  it("keeps the height and the geometry that has to add up to it in step", async () => {
    // 4 (pt-1) + 58 (the pill: 8 + 40 + 8 + 2 border) + 8 (pb-2) = 70, the
    // value of --tab-bar-h. Nothing else ties these together: swap the row's
    // padding for a symmetric `p-2` and every other assertion here still passes
    // while the pill sits 2px off centre in its own bar.
    const src = await code(BAR);
    expect(src, "row padding + pill height must sum to --tab-bar-h").toContain("pb-2 pt-1");
    expect(src, "the pill's own 8px").toContain("py-2");
    expect(src, "the button's 40px").toContain("h-10");
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
    // The drift this exists to stop: someone hardcodes a pixel offset on the
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

/**
 * The two navs are the same pill drawn at opposite edges, and their docblocks
 * say so in as many words. Nothing enforced that until this block: the model
 * cannot drift (one `NAV_TABS`, one `isActive`), but the markup could, and a
 * change to one file that the other does not get is exactly the failure the
 * cross-references were written to prevent.
 *
 * The deliberate differences are NOT asserted here — no mark, the pill's
 * padding, the gap, the row's inverted padding, and the tap-target pseudo. Each
 * has its own reason in its own file.
 */
describe("the two navs stay the same pill", () => {
  const SHARED = [
    "h-10",
    "rounded-control",
    "text-base font-semibold leading-[1.2]",
    "bg-fill-soft text-black",
    "text-shell-mute hover:text-shell-ink",
    "h-3 w-3 rounded-full bg-badge-due",
    "rounded-card",
    "border-shell-line/50",
    "shadow-[0_6px_6px_rgba(0,0,0,0.08)]",
  ];

  it.each(SHARED)("both files carry %s", async (cls) => {
    expect(await code(BAR)).toContain(cls);
    expect(await code(NAV)).toContain(cls);
  });

  it("names the unpaid state identically in both", async () => {
    // Both docblocks promise this string is "verbatim" the other's; a screen
    // reader hearing two different sentences for one fact is the bug.
    const label = '"Account — buy-in unpaid"';
    expect(await code(BAR)).toContain(label);
    expect(await code(NAV)).toContain(label);
  });
});

describe("fill-deep's one remaining consumer", () => {
  it("is Button's soft variant, and the token still exists at its hex", async () => {
    // The mobile bar's selected tab was this token until it took the header's
    // `fill-soft`. `Button` had been retyping the hex as an arbitrary value, so
    // pointing it at the token kept `fill.deep` live — but that leaves ONE
    // consumer and no other guard: rename the token and Button's hover compiles
    // to nothing, silently, on a component used across the app.
    expect(await read(CONFIG)).toContain('deep: "#EAEAEA"');
    expect(await code(new URL("../ui/Button.tsx", import.meta.url))).toContain(
      "hover:bg-fill-deep",
    );
  });
});

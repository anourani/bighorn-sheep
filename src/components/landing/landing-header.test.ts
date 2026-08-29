import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the signed-out header, shaped like
 * `header-nav.test.ts` and `bottom-tab-bar.test.ts` in `components/shell/`.
 * There is no jsdom here, so nothing renders `LandingHeader` — and until this
 * file it had no test at all, while the two navs it is now the third copy of
 * had two suites between them.
 *
 * The limit, stated plainly as the others state it: reading source for a string
 * cannot catch a typo in a class Tailwind never heard of. The 74px row, the
 * 58px pill, the ~362px intrinsic width and the fall-through in the dead band
 * are browser measurements and are not testable here.
 */
const HEADER = new URL("./LandingHeader.tsx", import.meta.url);
const NAV = new URL("../shell/HeaderNav.tsx", import.meta.url);
const BAR = new URL("../shell/BottomTabBar.tsx", import.meta.url);
const APP_HEADER = new URL("../shell/AppHeader.tsx", import.meta.url);

/**
 * Source with every comment removed. The assertions below are about what this
 * file DOES, and a docblock explaining why a class is deliberately absent would
 * otherwise fail the test that checks it is absent.
 *
 * Duplicated from `header-nav.test.ts` rather than extracted, which is what
 * `bottom-tab-bar.test.ts` already chose to do with the same helper.
 */
async function code(url: URL): Promise<string> {
  return (await readFile(url, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the signed-out pill's surface", () => {
  it("carries the design's border and shadow as resolvable classes", async () => {
    const src = await code(HEADER);
    expect(src).toContain("border-shell-line/50");
    expect(src).toContain("shadow-[0_6px_6px_rgba(0,0,0,0.08)]");
    expect(src).toContain("rounded-card");
    expect(src).toContain("bg-white");
  });

  it("keeps the shadow a box-shadow, because Modal is a fixed descendant", async () => {
    // Figma draws this shadow with a CSS filter. A filter makes its element a
    // containing block for `position: fixed` descendants — and `Modal` does NOT
    // portal (it renders inline, inside the pill), so a filter here would pin
    // the login dialog inside a 58px pill. `HeaderNav` refuses the filter for
    // the weaker version of this reason; here it is a real bug.
    expect(await code(HEADER)).not.toContain("drop-shadow");
  });

  it("is opaque, and ships no blur that could not show through it", async () => {
    // Only the desktop signed-out frame carries the 4px blur; the mobile
    // signed-out frame and both signed-in frames do not. On the band it would
    // capture the fixed dialog by the same rule as the filter above.
    expect(await code(HEADER)).not.toContain("backdrop-blur");
  });

  it("clips nothing, so the focus ring can draw past a button", async () => {
    // The global :focus-visible is ring-2 with a 2px offset — 4px beyond the
    // control, inside the pill's own padding only while nothing clips.
    expect(await code(HEADER)).not.toContain("overflow-hidden");
  });
});

describe("the signed-out pill's wrapper", () => {
  it("is sticky at the top, at the same depth as the signed-in header", async () => {
    const src = await code(HEADER);
    expect(src).toContain("sticky top-0 z-30");
    // The signed-in equivalent lives on `AppHeader`, the positioning wrapper —
    // `HeaderNav` draws the pill and owns no position of its own. This header
    // is a single component, so it carries both jobs.
    expect(await code(APP_HEADER)).toContain("sticky top-0 z-30");
  });

  it("draws at every width, unlike the signed-in header", async () => {
    // `AppHeader` is desktop-only and hands mobile to `BottomTabBar`. This one
    // has no breakpoint step at all: the design's mobile and desktop signed-out
    // frames are the same pill, and the only classes keyed to a width here are
    // the narrow escapes below.
    expect(await code(HEADER)).not.toContain("lg:");
  });

  it("passes clicks through the dead band and catches them on the pill", async () => {
    // The band spans the full shell while the pill draws about 366 of it, over
    // a title, a pitch and a table that scrolls sideways. This is also the only
    // reason the dialogs are clickable: `pointer-events` is inherited, and the
    // Modal is inside the pill.
    const src = await code(HEADER);
    expect(src).toContain("pointer-events-none");
    expect(src).toContain("pointer-events-auto");
  });

  it("clears the status bar on the pinned element, not the page wrapper", async () => {
    // `/` is reachable inside the installed PWA — the manifest is
    // start_url:/app, scope:/, display:standalone, and middleware bounces a
    // signed-out visitor off /app to here. `/app` puts this inset on its page
    // wrapper, which would only clear the bar at scroll 0 for a sticky element.
    // An arbitrary value fails silently if mistyped, and it shows nowhere but a
    // standalone launch.
    expect(await code(HEADER)).toContain("pt-[env(safe-area-inset-top)]");
  });

  it("pads the row symmetrically, where the signed-in row does not", async () => {
    // 8 + 58 + 8 = 74, off the frame. The signed-in row is 70 (`pb-1 pt-2`),
    // and a 4px difference between two files that are otherwise the same pill
    // is exactly the silent copy error worth pinning — `bottom-tab-bar.test.ts`
    // has a test whose whole subject is that class of mistake.
    expect(await code(HEADER)).toContain("py-2");
  });
});

describe("the signed-out pill's narrow-viewport escapes", () => {
  it("holds the frame's 100px button floor only from 375px up", async () => {
    // At 360 the mark, the gaps and the two buttons need about 362 with the
    // floor applied. Below 375 they take their content width — only "Log In"
    // actually moves, since "Enter Invite Code" measures past 100 on its own.
    // Same hatch `BottomTabBar` uses on the same pill.
    expect(await code(HEADER)).toContain("min-[375px]:min-w-[100px]");
  });

  it("narrows the row's own padding below that width too", async () => {
    expect(await code(HEADER)).toContain("min-[375px]:px-4");
  });
});

describe("the two ways in", () => {
  it("draws Log In filled and Enter Invite Code outlined", async () => {
    const src = await code(HEADER);
    expect(src).toContain("bg-shell-ink text-white hover:bg-[#333333]");
    expect(src).toContain("border border-shell-line bg-white text-shell-ink");
  });

  it("takes the design's small control box, not the nav button's", async () => {
    // 36px at 14px semibold with 8px of side padding, against the signed-in
    // tabs' 40px at 16px.
    const src = await code(HEADER);
    expect(src).toContain("h-9");
    expect(src).toContain("rounded-control");
    expect(src).toContain("text-sm font-semibold leading-[1.2]");
  });

  it("reaches a 44px tap target without overhanging the pill", async () => {
    // Beyond the frame, on `BottomTabBar`'s argument: this surface draws on
    // phones. The 4px each way lands inside the pill's own vertical padding,
    // and extending only on the y-axis keeps a button off its neighbour's taps.
    expect(await code(HEADER)).toContain("after:inset-x-0 after:-inset-y-1");
  });

  it("hands each button the skin that belongs to it", async () => {
    // Two consts of identical shape passed to two components of identical
    // shape: swapping them typechecks, renders, and is wrong only in colour.
    const src = await code(HEADER);
    expect(src).toContain("<LogInButton className={primaryButton} />");
    expect(src).toContain("<InviteCodeButton className={secondaryButton} />");
  });
});

describe("the signed-out header's app mark", () => {
  const SRC = "/icons/app-mark.jpg";

  it("is the same file the signed-in header draws", async () => {
    // One asset, two surfaces — so the photo cannot differ between the front
    // door and the app, and there is no way to stage them apart.
    expect(await code(HEADER)).toContain(SRC);
    expect(await code(NAV)).toContain(SRC);
  });

  it("points at a file that actually exists in public/", () => {
    // A 404 degrades to the grey circle and nothing in the browser says a word.
    expect(existsSync(new URL(`../../../public${SRC}`, import.meta.url))).toBe(true);
  });

  it("is a 40px circle, cropped rather than squashed", async () => {
    const src = await code(HEADER);
    expect(src).toContain("h-10 w-10");
    expect(src).toContain("rounded-full");
    expect(src).toContain("object-cover");
    expect(src).toContain("max-w-none");
  });

  it("is the only place this chrome names the app", async () => {
    // No wordmark in the frames, and the mark is not a link, so it cannot carry
    // the aria-label the signed-in mark hangs on its own. `APP_SHORT_NAME` was
    // deleted with the wordmark — this was its only reader.
    expect(await code(HEADER)).toContain("alt={APP_NAME}");
  });
});

describe("the signed-out header is not navigation", () => {
  it("claims no landmark, so only one Primary can ever be exposed", async () => {
    // Two buttons that open dialogs. A third "Primary" would break the
    // invariant both nav suites pin.
    expect(await code(HEADER)).not.toContain('aria-label="Primary"');
  });

  it("goes nowhere, so it links nowhere", async () => {
    expect(await code(HEADER)).not.toContain("next/link");
  });
});

describe("the pill is one card across three surfaces", () => {
  // The landing header shares the CARD with the two navs and nothing else —
  // it has no tabs, no selected state and no notification dot, so
  // `bottom-tab-bar.test.ts`'s nine-string parity block deliberately stays a
  // two-file check. These four are the card itself.
  const CARD = [
    "rounded-card",
    "border-shell-line/50",
    "bg-white",
    "shadow-[0_6px_6px_rgba(0,0,0,0.08)]",
  ];

  it.each(CARD)("all three files carry %s", async (cls) => {
    expect(await code(HEADER)).toContain(cls);
    expect(await code(NAV)).toContain(cls);
    expect(await code(BAR)).toContain(cls);
  });
});

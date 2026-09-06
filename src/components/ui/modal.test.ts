import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for `Modal`, shaped like `picks/pick-sticky-bar.test.ts`.
 *
 * There is no jsdom here, so nothing renders it; the geometry was measured in
 * Chromium. What these pin are the two properties whose failure is SILENT —
 * where the dialog looks like a design slip rather than a bug and nothing
 * reaches the console.
 *
 * This file exists late. `Modal` rendering inline cost four separate encounters
 * before it was fixed — two components mount their dialogs outside `.stagger` to
 * dodge it, `TourCarousel` documents it at length, and the fourth put a scrim
 * over one section of the account page — and there was no test on the primitive
 * the whole time.
 */
const MODAL = new URL("./Modal.tsx", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/** Source with every comment removed — see picks/pick-sticky-bar.test.ts. */
async function code(url: URL): Promise<string> {
  return (await read(url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Modal escapes its call site", () => {
  /*
   * THE BUG THIS PREVENTS. `.stagger > *` carries `reveal-up … both`, whose `to`
   * state is `transform: translateY(0)`. Fill-mode `both` leaves that transform
   * applied for the life of the page, and any non-`none` transform is a
   * containing block for `position: fixed` descendants — so a dialog rendered
   * inline inside one draws its full-viewport scrim over a single section
   * instead, with the panel centred in that box.
   *
   * A portal is the only fix that survives a careless call site, which is the
   * point: every alternative asks the caller to know where it may be mounted.
   */
  it("portals to document.body rather than rendering inline", async () => {
    const src = await code(MODAL);
    expect(src).toContain("createPortal");
    expect(src).toMatch(/return createPortal\(/);
    expect(src).toContain("document.body");
  });

  it("guards the portal on the server pass", async () => {
    // `createPortal` needs a real `document`. `open` is false on the server in
    // every caller today, but nothing structurally stops one passing true.
    expect(await code(MODAL)).toContain('typeof document === "undefined"');
  });
});

describe("Modal's two entrances", () => {
  /*
   * One element, two shapes: a bottom sheet below `sm` and a centred card from
   * `sm` (`items-end … sm:items-center`, `rounded-t-card sm:rounded-card`). The
   * animation has to turn over with the shape — a sheet rises, a card nudges —
   * and `max-w-app` is 480px, so on a phone this IS full-bleed and reads as a
   * drawer.
   *
   * Both classes survive `cn()` because `animate-*` and `sm:animate-*` land in
   * different tailwind-merge groups. That is not obvious and is exactly the kind
   * of thing a "simplification" removes; `TourCarousel` worked it out first.
   */
  it("slides up as a sheet on phones and nudges as a card from sm", async () => {
    const src = await code(MODAL);
    expect(src).toContain("animate-drawer-up sm:animate-reveal-up");
    // The shape it animates has to agree with the animation.
    expect(src).toContain("items-end justify-center sm:items-center");
    expect(src).toContain("rounded-t-card");
    expect(src).toContain("sm:rounded-card");
  });

  it("keeps the scrim on scrim-in, never reveal-up", async () => {
    // `reveal-up` starts at translateY(12px), which slid an `absolute inset-0`
    // scrim 12px down and left the top 12px of the screen unscrimmed.
    const src = await code(MODAL);
    expect(src).toContain("animate-scrim-in");
    expect(src).not.toMatch(/inset-0[^"]*animate-reveal-up/);
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Source-text guards for the tour, shaped like `landing-header.test.ts` and
 * `pick-sticky-bar.test.ts`. There is no jsdom in this repo, so nothing here
 * renders — these read the files and assert on what they contain.
 *
 * The limit is the same one those files state: reading source for a string
 * cannot catch a typo in a class Tailwind never heard of, and it cannot measure
 * anything. What it CAN catch is the class of mistake that costs nothing to
 * make and shows no symptom until someone opens the app — a fixed height
 * quietly becoming content-driven, an illustration growing a focusable control,
 * a hex creeping back in where a token exists. Everything asserted below is one
 * of those.
 */
const CAROUSEL = new URL("./TourCarousel.tsx", import.meta.url);
const ART = new URL("./TourArt.tsx", import.meta.url);
const FIRST_RUN = new URL("./FirstRunTour.tsx", import.meta.url);
const PICKS_PAGE = new URL("../../app/app/page.tsx", import.meta.url);
const MY_PICKS = new URL("../picks/MyPicksClient.tsx", import.meta.url);
const LOAD = new URL("../../lib/league/load.ts", import.meta.url);
const ACCOUNT = new URL("../account/AccountClient.tsx", import.meta.url);

/**
 * Source with every comment removed. The assertions are about what these files
 * DO, and several of them explain in prose exactly the thing they must not
 * contain — the note about drawing a radio rather than using a real input would
 * otherwise fail the test that checks for inputs.
 *
 * Duplicated rather than extracted, which is what `landing-header.test.ts` and
 * `bottom-tab-bar.test.ts` already chose to do with the same helper.
 */
async function code(url: URL): Promise<string> {
  return (await readFile(url, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the sheet's height contract", () => {
  /**
   * The PRD's acceptance criterion — "sheet/modal height is stable across all 7
   * steps (no jump)" — reduced to the two classes that deliver it. Both are
   * fixed heights on boxes whose content varies step to step, so anything that
   * makes either content-driven reintroduces the jump with nothing failing.
   */
  it("pins the art frame and the body to fixed heights", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("h-[180px]");
    expect(src).toContain("h-[72px]");
  });

  /**
   * Belt and braces rather than a live constraint: the longest title is 24
   * characters, still well short of wrapping. It stays because a
   * future title that DID wrap would take the panel's height with it — the same
   * failure as above, reached from the other end.
   */
  it("keeps the title on one line", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("truncate");
  });
});

describe("the dialog surface", () => {
  it("borrows the app's scrim rather than inventing one", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("bg-ink/45");
    expect(src).toContain("backdrop-blur-[2px]");
    expect(src).toContain("animate-scrim-in");
  });

  /**
   * Two entrances, one per presentation: the full-height slide on a phone, the
   * 12px fade for the centred card. They land in different tailwind-merge
   * groups, so both survive `cn()` — a single `animate-*` here would mean a
   * desktop modal flying up from the bottom of the screen.
   */
  it("slides as a sheet and fades as a card", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("animate-drawer-up");
    expect(src).toContain("sm:animate-reveal-up");
  });

  it("is 480px and sits above every other layer", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("max-w-app");
    // Above BottomTabBar and AppHeader, both z-30.
    expect(src).toContain("z-50");
  });

  /**
   * The trap is this surface's alone: the page behind it is the pick grid, and
   * a keyboard user who tabs out of an untrapped dialog can spend a team for
   * the season. Reusing `drawer.ts` rather than rewriting the arithmetic is
   * what keeps it tested.
   */
  it("traps focus using the drawer's tested helpers", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain("FOCUSABLE_SELECTOR");
    expect(src).toContain("nextFocusIndex");
    expect(src).toContain("isConnected");
  });

  /**
   * The struck word must be BOTH struck and hidden. `<s>` alone leaves a screen
   * reader announcing "the team you know think is going to win", which is not a
   * joke, just a broken sentence — and nothing about the rendered page would
   * look wrong to whoever removed the attribute.
   */
  it("hides the struck word from the accessibility tree", async () => {
    const src = await code(CAROUSEL);
    expect(src).toMatch(/<s key=\{i\} aria-hidden="true">/);
  });
});

describe("the illustrations", () => {
  /**
   * The frame is `aria-hidden`, so anything focusable inside it is unreachable
   * by a screen reader and yet still a tab stop — and a control that looks like
   * a team card but does nothing is worse than a picture of one. Reusing
   * `BottomTabBar` or a real radio would each break this silently.
   */
  it("contain nothing focusable, navigational, or interactive", async () => {
    const src = await code(ART);
    for (const forbidden of ["<button", "onClick", "tabIndex", "<a ", "<nav", "<input", "href"]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("are hidden from the accessibility tree by the frame that holds them", async () => {
    const src = await code(CAROUSEL);
    expect(src).toContain('aria-hidden="true"');
  });

  /**
   * Every one of these has a token, and the design was transcribed FROM those
   * tokens in the first place. A raw hex here is a value that stops tracking
   * the palette — `accent.ts` exists so switching the accent is a one-line
   * change, and a hardcoded #FC5F38 in a picture of the app defeats it.
   */
  it("use tokens rather than the hexes those tokens resolve to", async () => {
    const src = await code(ART);
    for (const hex of [
      "#FC5F38",
      "#1E1E1E",
      "#757575",
      "#D9D9D9",
      "#F3F3F3",
      "#FAFAFA",
      "#EEF1F6",
      "#3A4356",
      "rgba(123,225,112",
      "rgba(205,20,17",
    ]) {
      expect(src).not.toContain(hex);
    }
  });

  /**
   * The pill's two colours are `Pill`'s `hidden` variant exactly, so the
   * component is reused rather than the hexes retyped — which is also what the
   * assertion above enforces from the other side.
   */
  it("reuse Pill for the hidden-pick state", async () => {
    const src = await code(ART);
    expect(src).toContain('variant="hidden"');
  });

  /**
   * The real bar's own responsive rule, not an approximation of it: three 100px
   * tabs plus padding do not fit the art frame on a 320px phone, and the frame
   * is `overflow-hidden`, so the failure would be silent amputation.
   */
  it("shrink the tab pill below 375px the way the real bar does", async () => {
    const src = await code(ART);
    expect(src).toContain("min-[375px]:min-w-[100px]");
  });

  /** The three 281px scenes must shrink inside the frame rather than be clipped. */
  it("let the fixed-width scenes shrink", async () => {
    const src = await code(ART);
    expect(src).not.toMatch(/w-\[281px\](?! max-w-full)/);
  });
});

describe("where the tour mounts", () => {
  /**
   * The single most expensive mistake available here, and it throws nothing.
   *
   * `MyPicksClient`'s root is `.stagger`, whose `reveal-up ... both` leaves a
   * transform applied for the life of the page — and a non-`none` transform
   * makes an element a containing block for `position: fixed` descendants. A
   * tour rendered anywhere inside that subtree is pinned to a page block
   * instead of the viewport. It does not portal, so the mount point IS the fix.
   */
  it("renders from the page, never from inside the staggered picks root", async () => {
    const page = await code(PICKS_PAGE);
    const picks = await code(MY_PICKS);
    expect(page).toContain("<FirstRunTour");
    expect(picks).not.toContain("FirstRunTour");
    expect(picks).not.toContain("TourCarousel");
  });

  /** Beside the modals, outside the account page's own `.stagger`, same reason. */
  it("renders the replay outside the account page's staggered root", async () => {
    const src = await code(ACCOUNT);
    const stagger = src.indexOf('className="stagger');
    const tour = src.indexOf("<TourCarousel");
    expect(stagger).toBeGreaterThan(-1);
    expect(tour).toBeGreaterThan(stagger);
    // The two dialogs already living outside that root are the precedent; the
    // tour must sit with them rather than above the closing tag.
    expect(tour).toBeGreaterThan(src.indexOf("<DeleteAccountModal"));
  });

  /**
   * Replaying is not completing. Only the first-run wrapper writes, so a player
   * who opens the tour deliberately does not have that recorded as their
   * first viewing — and there is no skip to offer someone who asked for it.
   */
  it("replays without completing the tour", async () => {
    const src = await code(ACCOUNT);
    expect(src).toContain("showSkip={false}");
    expect(src).not.toContain("completeTour");
  });

  it("completes on every exit, from the first-run wrapper only", async () => {
    const src = await code(FIRST_RUN);
    expect(src).toContain("completeTour");
  });
});

describe("reading the flag", () => {
  /**
   * CLAUDE.md's rule made mechanical: PostgREST answers 42703 for an unknown
   * column and fails the WHOLE query, so naming `tour_completed_at` beside
   * `first_name` would have taken the picks screen, the standings board and the
   * account page down together in the window before 0016 is applied by hand.
   */
  it("never widens an existing profiles select", async () => {
    const src = await code(LOAD);
    expect(src).toContain('.select("tour_completed_at")');
    expect(src).toContain('.select("first_name, last_name, favorite_animal")');
    expect(src).toContain('.select("first_name, last_name, favorite_animal, created_at")');
    for (const widened of [
      '"first_name, last_name, favorite_animal, tour_completed_at"',
      '"tour_completed_at, first_name',
    ]) {
      expect(src).not.toContain(widened);
    }
  });

  /**
   * The failure direction is the whole design. Failing the other way would fire
   * an undismissable tour on every load, because the write would be failing for
   * exactly the same reason.
   */
  it("fails open, so an unapplied 0016 leaves the tour inert", async () => {
    const src = await code(LOAD);
    const fn = src.slice(src.indexOf("export const viewerTourCompleted"));
    const body = fn.slice(0, fn.indexOf("export const viewerBuyInUnpaid"));
    expect(body).toMatch(/if \(error\)[\s\S]*?return true;/);
  });
});

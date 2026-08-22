import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The invite module's photo, guarded the same way the animal avatars are.
 *
 * There is no jsdom here, so nothing renders `InviteCta` in a test. What CAN be
 * checked is the one thing about it that fails invisibly: a missing file 404s,
 * the `<img>` degrades to its `bg-shell-line` grey square, and the result is a
 * plausible-looking placeholder that nothing in the browser reports. Exactly the
 * failure `src/lib/profile/animals.test.ts` exists for.
 */
describe("the Grow the League photo", () => {
  // Trailing slash matters: without it the last segment is replaced, not appended.
  const PUBLIC_DIR = new URL("../../../public/", import.meta.url);
  const SRC = "/icons/grow-the-league.webp";

  it("is served from /icons/, the only path the service worker caches", () => {
    expect(
      SRC.startsWith("/icons/"),
      "The service worker's runtime cache accepts only /_next/static/ and /icons/ " +
        "(src/app/sw.js/route.ts). Art outside /icons/ is refetched on every load and " +
        "missing offline, which nothing else in the app would report.",
    ).toBe(true);
  });

  it("points at a file that actually exists in public/", () => {
    expect(
      existsSync(new URL(`.${SRC}`, PUBLIC_DIR)),
      `Artwork is missing from public${SRC}. InviteCta renders this photo as the ` +
        "whole left half of its card, so without it the module ships a grey square " +
        "and nothing errors.",
    ).toBe(true);
  });

  it("is referenced by InviteCta at exactly this path", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./InviteCta.tsx", import.meta.url), "utf8"),
    );
    expect(
      source.includes(SRC),
      "InviteCta no longer references this path — update SRC here, or the two " +
        "checks above are guarding a file nothing uses.",
    ).toBe(true);
  });
});

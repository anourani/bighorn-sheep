import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import tailwind from "../../tailwind.config";
import { ACCENT as SOURCE } from "./accent";

/**
 * The palette's ONE invariant: every orange in the app derives from `ACCENT` in
 * `tailwind.config.ts`, so changing that line repaints all of them together.
 *
 * Read out of the config the way `card-reveal.test.ts` reads the `blur-in`
 * keyframe. Values are only ever checked against EACH OTHER, never against a
 * hardcoded hex, so switching the accent stays a one-line change that leaves
 * this file green. What it catches is the opposite: a literal pasted back in,
 * quietly re-stranding one surface on the old hue — which is exactly how the
 * palette came to hold four unrelated oranges in the first place.
 */
type Family = Record<string, string>;

// Tailwind types `extend` as deeply resolvable (every leaf may be a function of
// PluginUtils), which none of these are. One cast at the boundary beats a dozen
// non-null assertions inside the assertions themselves.
const extend = tailwind.theme?.extend as unknown as {
  colors: Record<string, Family | string | undefined>;
  backgroundImage: Record<string, string | undefined>;
  boxShadow: Record<string, string | undefined>;
};

/** A token that must exist — the assertions below are about its value. */
const hex = (family: string, key: string): string => {
  const value = (extend.colors[family] as Family | undefined)?.[key];
  if (typeof value !== "string") throw new Error(`missing colour token ${family}.${key}`);
  return value;
};

/** A token that may not exist — used to prove the retired ones are gone. */
const token = (family: string, key: string) =>
  (extend.colors[family] as Family | undefined)?.[key];

/** Cheap ordering key. Not perceptual luminance — only used for "is lighter". */
const weight = (value: string) =>
  [1, 3, 5].reduce((sum, i) => sum + parseInt(value.slice(i, i + 2), 16), 0);

const ACCENT = hex("accent", "DEFAULT");

describe("the accent is a single source of truth", () => {
  it("is a plain 6-digit hex, so Tailwind's /opacity modifier still resolves", () => {
    expect(ACCENT).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("derives `faded` from the accent itself, not from a second literal", () => {
    // The design library's `Text Color/Accent faded` is the accent plus an
    // alpha byte (0x14 = 20/255 ≈ 8%). Built from it so it can never name a
    // different hue than the token it is the faded version of.
    expect(hex("accent", "faded")).toBe(`${ACCENT}14`);
  });

  it("keeps `brand.strong` and `live` pointed at the accent", () => {
    // Both were #ED7B46 — the accent under two other names.
    expect(hex("brand", "strong")).toBe(ACCENT);
    expect(hex("live", "DEFAULT")).toBe(ACCENT);
  });

  it("mixes the light ramp toward white without going translucent", () => {
    // `StandingsGrid` paints its STICKY name column with `bg-brand-wash`, and a
    // translucent value there lets the scrolling rows show through it. So these
    // are build-time mixes, not `accent/NN` opacity modifiers.
    const ramp = ["accent.ink", "brand.DEFAULT", "brand.soft", "brand.wash", "live.wash"];
    for (const path of ramp) {
      const [family, key] = path.split(".") as [string, string];
      expect(hex(family, key)).toMatch(/^#[0-9A-F]{6}$/);
    }
    // Ordered dark to light: ink sets type, wash sits behind it.
    const ordered = [
      hex("accent", "ink"),
      ACCENT,
      hex("brand", "DEFAULT"),
      hex("brand", "soft"),
      hex("brand", "wash"),
    ].map(weight);
    expect(ordered).toStrictEqual([...ordered].sort((a, b) => a - b));
  });

  it("feeds the sheen gradient and the glow shadow", () => {
    // The two keys outside `colors` that used to retype the brand hex by hand.
    expect(extend.backgroundImage["brand-sheen"]).toContain(ACCENT);
    const channels = [1, 3, 5].map((i) => parseInt(ACCENT.slice(i, i + 2), 16)).join(",");
    expect(extend.boxShadow.glow).toContain(channels);
  });

  it("is the value `src/lib/accent.ts` exports, not a second copy", () => {
    // The config, `layout.tsx`'s themeColor and `global-error.tsx`'s inline
    // button all read that one module. If this fails, the config has gone back
    // to declaring its own hex and the two non-Tailwind surfaces have drifted.
    expect(ACCENT).toBe(SOURCE);
  });

  it("has retired the tokens the accent replaced", () => {
    // `selected` (#0C6F28) and `shell.alive` (#FC855C) were the other two "this
    // is lit / this is yours" fills; `result.*-lit` existed only to survive the
    // old green chip fill, which is now `accent`.
    expect(extend.colors.selected).toBeUndefined();
    expect(token("shell", "alive")).toBeUndefined();
    expect(token("result", "win-lit")).toBeUndefined();
    expect(token("result", "loss-lit")).toBeUndefined();
  });
});

/**
 * The static assets that carry the accent by hand. None of them can import
 * `accent.ts` — one is JSON the browser reads, two are artwork — so this is the
 * only thing standing between a hue change and an icon left on the previous
 * one. Nothing in a browser would report that: the icon simply looks right, in
 * the wrong colour, in the tab and on the home screen.
 *
 * The five rasters are RENDERED from the two SVGs, so guarding the sources
 * covers them — but only if whoever changes ACCENT re-renders. The failure
 * messages name them for that reason; see `src/lib/accent.ts` for the recipe.
 */
describe("the hand-copied static assets stay in step", () => {
  const PUBLIC_DIR = new URL("../../public/", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, PUBLIC_DIR), "utf8");

  const RENDERED_FROM: Record<string, string[]> = {
    "icons/icon.svg": ["favicon.ico", "icons/icon-192.png", "icons/icon-512.png"],
    "icons/icon-maskable.svg": ["icons/maskable-512.png", "icons/apple-touch-icon.png"],
  };

  it("keeps the PWA theme colour on the accent", () => {
    expect(
      read("manifest.webmanifest"),
      "public/manifest.webmanifest's theme_color has drifted off ACCENT. It paints " +
        "the browser chrome and the task switcher, and nothing in the app reads it.",
    ).toContain(`"theme_color": "${ACCENT}"`);
  });

  // Both SVGs carry the same three hexes: the gradient's two stops (the accent
  // and `brand.DEFAULT`, mirroring `bg-brand-sheen`) and the tick, which is the
  // accent straight. `icon.svg` is round-cornered and is the browser favicon;
  // `icon-maskable.svg` is squared off for a maskable icon's safe zone.
  for (const [svg, rasters] of Object.entries(RENDERED_FROM)) {
    it(`keeps ${svg} on the accent`, () => {
      const source = read(svg);
      const stale =
        `public/${svg} has drifted off ACCENT. Re-render it and the ${rasters.length} ` +
        `raster(s) built from it (${rasters.join(", ")}) — see src/lib/accent.ts.`;
      expect(source, stale).toContain(`stop-color="${ACCENT}"`);
      expect(source, stale).toContain(`stop-color="${hex("brand", "DEFAULT")}"`);
      expect(source, stale).toContain(`stroke="${ACCENT}"`);
    });
  }

  it("still ships every raster those SVGs are rendered into", () => {
    // Not a colour check — no PNG decoder here, and adding a dependency for one
    // is not worth it. This catches the other half: a rename or a deletion that
    // leaves `layout.tsx` / the manifest pointing at a 404, which degrades to a
    // blank favicon and an install with no icon, silently.
    for (const file of Object.values(RENDERED_FROM).flat()) {
      const size = statSync(new URL(file, PUBLIC_DIR)).size;
      expect(size, `public/${file} is missing or empty`).toBeGreaterThan(512);
    }
  });
});

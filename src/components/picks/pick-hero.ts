/**
 * Pure helpers for the My Picks hero, kept out of the component so they
 * unit-test — the same split as `week-strip.ts` / `WeekStrip.tsx` next door.
 * Vitest runs in the Node environment here; there is no jsdom and no
 * @testing-library, so a pure module is the only testable shape.
 */

/** The ramp's two alphas, from the design. */
const LIGHT = 0.25;
const DEEP = 0.8;

/**
 * The team-colour ramp painted behind a pick — one call per strip.
 *
 * Deliberately a single-hue ALPHA ramp and not a two-colour blend: `teams.ts`
 * carries exactly one brand hex per franchise, so a second stop would have to be
 * invented for all 32. The three strips alternate `down` / `up` / `down` so they
 * read as one object catching light rather than as three copies of one bar.
 *
 * Nothing is painted underneath. The predecessor of this ramp washed the whole
 * module and sat on a hard `#fff` because a WCAG calculation had to know the
 * exact composite; no text sits on these strips, so they composite straight onto
 * the page (`bg`, #FDFDFD) and that 2/255 difference does not earn a
 * declaration.
 */
export function stripGradient(hex: string, direction: "down" | "up"): string {
  const [r, g, b] = hexToRgb(hex);
  const [top, bottom] = direction === "down" ? [LIGHT, DEEP] : [DEEP, LIGHT];
  return `linear-gradient(180deg, rgba(${r},${g},${b},${top}) 0%, rgba(${r},${g},${b},${bottom}) 100%)`;
}

/** "#RRGGBB" (or "#RGB") → [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

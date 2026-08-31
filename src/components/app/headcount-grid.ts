/**
 * How big a headcount cube is, and how many fit on a row.
 *
 * Its own module, and pure, because there is no jsdom in this repo: a component
 * cannot be tested here, so anything with a rule worth pinning has to be liftable
 * out of the JSX first. `week-strip.ts` and `card-reveal.ts` beside the pick
 * surfaces are the same shape.
 *
 * Relative imports only if this ever gains one. There is no `vitest.config.ts`,
 * so vitest never reads tsconfig's `paths` and a `@/` VALUE import resolves under
 * Next and throws under the test runner.
 */

/**
 * A cube's drawn size and the range it may move within to avoid a lone cube on
 * the last row.
 *
 * The two scales no longer agree about direction, and that is the thing to know
 * here. The desktop's base IS its max, so a desktop cube can only shrink. The
 * phone's base sits INSIDE its range, so a phone cube can go either way — which
 * makes `sizesFromBase`'s tie-break load-bearing rather than decorative, because
 * 15 and 17 are equally far from 16. Both ranges are transcribed from the cube
 * atom, not derived.
 */
export interface CubeScale {
  /** What the design draws at, and what the pre-measurement CSS paints. */
  base: number;
  min: number;
  max: number;
}

/** Figma cube atom `3746:39826`, Mobile variant. */
export const CUBE_PHONE: CubeScale = { base: 16, min: 14, max: 18 };

/** Figma cube atom `3746:39826`, Desktop variant. */
export const CUBE_DESKTOP: CubeScale = { base: 24, min: 20, max: 24 };

/** 2px at both widths — the frames agree, where the old strip's gap did not. */
export const CUBE_GAP = 2;

export interface CubeLayout {
  size: number;
  columns: number;
}

/**
 * How many `size` cubes fit across `width` with `gap` between them.
 *
 * n cubes occupy `n * size + (n - 1) * gap`, which is `n * (size + gap) - gap` —
 * hence the `+ gap` on the numerator rather than a loop.
 *
 * This is CSS Grid's own `repeat(auto-fill, …)` formula restated, which is the
 * point: fed the same fractional width the browser lays out against, our count
 * and its count cannot disagree. It also guarantees
 * `columns * size + (columns - 1) * gap <= width` for every input, so a row can
 * never be wider than the box it was solved for — which matters because the grid
 * sits inside a filled card that fills the content column, and at `lg` that
 * column has no page inset left to absorb an overflow.
 */
export function columnsFor(width: number, size: number, gap: number): number {
  if (!(width > 0) || !(size > 0)) return 1;
  return Math.max(1, Math.floor((width + gap) / (size + gap)));
}

/**
 * The thing the whole module exists to prevent: a last row holding exactly one
 * cube.
 *
 * `count > columns` is not a micro-optimisation. Without it a one-member league
 * reports an orphan at every size in range, the solver exhausts the range, and
 * the cube ends up at the fallback for a row it was never going to share.
 */
export function orphanRow(count: number, columns: number): boolean {
  return count > columns && count % columns === 1;
}

/**
 * Integer sizes in the scale, nearest the base first — the order the solver
 * tries them in, so a cube never moves further from the design than it has to.
 *
 * **Ties go to the LARGER size**, and on the phone that decides real output: its
 * base is 16 in a 14-18 range, so 17 is tried before 15 and 18 before 14. Grow
 * before shrink, because a cube below the drawn size reads as a rendering fault
 * where one above it reads as a deliberate size. There is a test pinning the
 * order; the desktop range has no tie to break.
 */
function sizesFromBase(scale: CubeScale): number[] {
  const sizes: number[] = [];
  for (let size = scale.min; size <= scale.max; size += 1) sizes.push(size);
  return sizes.sort(
    (a, b) => Math.abs(a - scale.base) - Math.abs(b - scale.base) || b - a,
  );
}

/**
 * The size every cube takes and the number of columns to lay them out in.
 *
 * One size for ALL of them — the frames draw a uniform grid with a ragged last
 * row, not per-row stretching, whatever Figma's fill-container transcription
 * suggests.
 *
 * `width` wants to be the FRACTIONAL content width a ResizeObserver reports, not
 * a rounded `clientWidth`: rounding up by half a pixel is how a solver and a
 * browser end up disagreeing about the last column, and `columnsFor`'s guarantee
 * above is exact only on the real number.
 *
 * Falling back to `base` when nothing in range clears the orphan is deliberate.
 * A cube outside the design's min/max is a worse answer than a lone cube.
 */
export function cubeLayout(
  count: number,
  width: number,
  scale: CubeScale,
  gap: number = CUBE_GAP,
): CubeLayout {
  const fallback = { size: scale.base, columns: columnsFor(width, scale.base, gap) };
  if (count <= 0) return fallback;

  for (const size of sizesFromBase(scale)) {
    const columns = columnsFor(width, size, gap);
    if (!orphanRow(count, columns)) return { size, columns };
  }
  return fallback;
}

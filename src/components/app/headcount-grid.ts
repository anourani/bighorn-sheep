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
 * The two scales encode the direction of travel on their own, which is why the
 * solver below needs no separate "grow or shrink?" rule: the phone's base IS its
 * max, so a phone cube can only shrink; the desktop's base IS its min, so a
 * desktop cube can only grow. Both are transcribed, not derived.
 */
export interface CubeScale {
  /** What the design draws at, and what the pre-measurement CSS paints. */
  base: number;
  min: number;
  max: number;
}

/** Figma cube atom `3746:39826`, Mobile variant. */
export const CUBE_PHONE: CubeScale = { base: 16, min: 12, max: 16 };

/** Figma cube atom `3746:39826`, Desktop variant. */
export const CUBE_DESKTOP: CubeScale = { base: 24, min: 24, max: 30 };

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
 * never be wider than the box it was solved for — which matters because below
 * `lg` this grid is full-bleed, and one column too many there is a
 * document-level horizontal scrollbar.
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
 * Ties go to the larger size, though neither scale currently has a tie to break.
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

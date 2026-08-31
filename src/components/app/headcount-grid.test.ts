import { describe, expect, it } from "vitest";

import {
  CUBE_DESKTOP,
  CUBE_GAP,
  CUBE_PHONE,
  columnsFor,
  cubeLayout,
  orphanRow,
} from "./headcount-grid";

describe("columnsFor", () => {
  it("counts the cubes that fit, gaps included", () => {
    // The card's inner grid at each width: 968 at desktop (the 1000px column
    // less the card's 16px sides), 333 on a 393px phone (361 less 12px sides
    // less the frame's own 2px inset).
    expect(columnsFor(968, 24, 2)).toBe(37);
    expect(columnsFor(333, 16, 2)).toBe(18);
  });

  it("never reports fewer than one column", () => {
    expect(columnsFor(0, 24, 2)).toBe(1);
    expect(columnsFor(-50, 16, 2)).toBe(1);
  });

  it("does not charge a gap to the last cube in a row", () => {
    // Three 10px cubes with 2px between them are 34px, not 36.
    expect(columnsFor(34, 10, 2)).toBe(3);
    expect(columnsFor(33, 10, 2)).toBe(2);
  });
});

describe("orphanRow", () => {
  it("is a lone cube on a LAST row, not a lone cube", () => {
    expect(orphanRow(38, 37)).toBe(true);
    expect(orphanRow(1, 37)).toBe(false);
    expect(orphanRow(37, 37)).toBe(false);
    expect(orphanRow(39, 37)).toBe(false);
  });
});

describe("cubeLayout", () => {
  it("draws at the design's size when the last row is already shared", () => {
    expect(cubeLayout(74, 968, CUBE_DESKTOP)).toEqual({ size: 24, columns: 37 });
  });

  it("shrinks a desktop cube to break up a lone one", () => {
    // 38 across 37 columns leaves one on its own; 23px fits 38, so they land on
    // a single row. Desktop can only shrink — its base IS its max.
    expect(cubeLayout(38, 968, CUBE_DESKTOP)).toEqual({ size: 23, columns: 38 });
  });

  it("grows a phone cube to break up a lone one", () => {
    // 333px is the card's inner grid on a 393px phone. 19 cubes over 18 columns
    // strands one; 17px fits 17. Note it GREW — 15px would have worked too (19
    // columns, remainder 0) and is exactly as far from the base, and the
    // tie-break sends it up rather than down.
    expect(cubeLayout(19, 333, CUBE_PHONE)).toEqual({ size: 17, columns: 17 });
  });

  it("solves against a fractional width, which is what the observer reports", () => {
    // The browser lays out against the real number, so the solver has to as
    // well: rounding up first is how the two end up one column apart.
    expect(cubeLayout(74, 967.6, CUBE_DESKTOP)).toEqual({ size: 24, columns: 37 });
    expect(cubeLayout(74, 966.4, CUBE_DESKTOP)).toEqual({ size: 24, columns: 37 });
  });

  it("leaves a one-member league alone", () => {
    expect(cubeLayout(1, 968, CUBE_DESKTOP)).toEqual({ size: 24, columns: 37 });
    expect(cubeLayout(0, 968, CUBE_DESKTOP)).toEqual({ size: 24, columns: 37 });
  });

  it("returns the base size rather than an unmeasured one", () => {
    expect(cubeLayout(30, 0, CUBE_PHONE).size).toBe(CUBE_PHONE.base);
    expect(cubeLayout(30, 1, CUBE_PHONE).size).toBe(CUBE_PHONE.base);
  });

  it("keeps the cube in range even when no size clears the orphan", () => {
    // At 40px every size from 14 to 18 fits exactly two columns, so three cubes
    // strand one whatever we do. A cube outside the design's min/max would be
    // the worse answer.
    expect(cubeLayout(3, 40, CUBE_PHONE)).toEqual({ size: 16, columns: 2 });
  });

  it("solves within range, or admits the base, at every plausible width", () => {
    const widths = [264, 288, 321, 333, 374, 640, 936, 966, 967.6, 968, 1000];
    for (const scale of [CUBE_PHONE, CUBE_DESKTOP]) {
      for (const width of widths) {
        for (let count = 1; count <= 200; count += 1) {
          const { size, columns } = cubeLayout(count, width, scale);
          expect(size).toBeGreaterThanOrEqual(scale.min);
          expect(size).toBeLessThanOrEqual(scale.max);
          expect(columns).toBe(columnsFor(width, size, CUBE_GAP));
          if (orphanRow(count, columns)) expect(size).toBe(scale.base);
        }
      }
    }
  });

  // The property the full-bleed grid rests on: a row wider than its box is a
  // document-level horizontal scrollbar below `lg`.
  it("never lays a row wider than the box it measured", () => {
    for (const scale of [CUBE_PHONE, CUBE_DESKTOP]) {
      for (const width of [264, 288, 320.5, 333, 640, 936, 967.6, 968]) {
        for (let count = 1; count <= 120; count += 1) {
          const { size, columns } = cubeLayout(count, width, scale);
          const row = columns * size + (columns - 1) * CUBE_GAP;
          expect(row).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});

describe("the cube scales", () => {
  it("transcribes the cube atom", () => {
    expect(CUBE_PHONE).toEqual({ base: 16, min: 14, max: 18 });
    expect(CUBE_DESKTOP).toEqual({ base: 24, min: 20, max: 24 });
    expect(CUBE_GAP).toBe(2);
  });

  // The desktop base sits at the top of its range, so that cube only ever
  // shrinks and the tie-break can never fire on it. The phone's sits INSIDE
  // its range, which is what makes the tie-break real — 15 and 17 are equally
  // far from 16, and only one of them can be tried first.
  it("only ever shrinks a desktop cube", () => {
    expect(CUBE_DESKTOP.base).toBe(CUBE_DESKTOP.max);
  });

  it("breaks a phone tie upward, never downward", () => {
    // Both 15 and 17 clear the orphan at this width (19 columns and 17), and
    // both are one step from the base. Growing is the answer: a cube under the
    // drawn size reads as a rendering fault, one over it as a chosen size.
    expect(columnsFor(333, 15, CUBE_GAP)).toBe(19);
    expect(columnsFor(333, 17, CUBE_GAP)).toBe(17);
    expect(cubeLayout(19, 333, CUBE_PHONE).size).toBe(17);
  });
});

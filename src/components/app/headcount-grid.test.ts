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
    // The two frames: 968px desktop at 24px, 359px mobile at 16px.
    expect(columnsFor(968, 24, 2)).toBe(37);
    expect(columnsFor(359, 16, 2)).toBe(20);
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

  it("grows a desktop cube to break up a lone one", () => {
    // 38 across 37 columns leaves one on its own; 25px fits 35.
    expect(cubeLayout(38, 968, CUBE_DESKTOP)).toEqual({ size: 25, columns: 35 });
  });

  it("shrinks a phone cube to break up a lone one", () => {
    // 389px is a 393px viewport less the wrapper's 2px either side. 22 cubes
    // over 21 columns strands one; 15px fits 23, so they land on a single row.
    expect(cubeLayout(22, 389, CUBE_PHONE)).toEqual({ size: 15, columns: 23 });
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
    // At 37px every size from 12 to 16 fits exactly two columns, so three cubes
    // strand one whatever we do. A cube outside the design's min/max would be
    // the worse answer.
    expect(cubeLayout(3, 37, CUBE_PHONE)).toEqual({ size: 16, columns: 2 });
  });

  it("solves within range, or admits the base, at every plausible width", () => {
    const widths = [320, 360, 389, 393, 430, 640, 768, 966, 967.6, 968, 1000];
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
      for (const width of [320, 359.5, 360, 392.7, 768, 967.6, 968, 1000]) {
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
  // The solver has no separate grow-or-shrink rule; it falls out of where the
  // base sits in the range, so these two facts are what make it correct.
  it("lets a phone cube only shrink and a desktop cube only grow", () => {
    expect(CUBE_PHONE.base).toBe(CUBE_PHONE.max);
    expect(CUBE_DESKTOP.base).toBe(CUBE_DESKTOP.min);
  });
});

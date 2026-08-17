import { describe, expect, it } from "vitest";
import { nextIndex, scrollLeftFor } from "./week-strip";

// A strip of 50px chips with a 1px gap, ten of them, in a 200px window.
const chip = (i: number) => ({ itemStart: i * 51, itemWidth: 50 });
const strip = { viewWidth: 200, contentWidth: 510 };

describe("scrollLeftFor", () => {
  describe("center", () => {
    it("puts the chip's midpoint on the viewport's midpoint", () => {
      // chip 5 spans 255..305, midpoint 280; a 200px window centred there
      // starts at 180.
      expect(
        scrollLeftFor({ ...strip, ...chip(5), scrollLeft: 0, align: "center" }),
      ).toBe(180);
    });

    // The first and last chips have no content past the edge to fill the other
    // half of the window, so they settle flush. Without the clamp the scroller
    // is asked for a negative offset, and a smooth scroll visibly over-travels
    // and springs back.
    it("clamps at both extremes rather than over-travelling", () => {
      expect(scrollLeftFor({ ...strip, ...chip(0), scrollLeft: 0, align: "center" })).toBe(0);
      expect(scrollLeftFor({ ...strip, ...chip(9), scrollLeft: 0, align: "center" })).toBe(310);
    });

    it("stays put when the content fits the window", () => {
      expect(
        scrollLeftFor({
          viewWidth: 600,
          contentWidth: 510,
          ...chip(9),
          scrollLeft: 0,
          align: "center",
        }),
      ).toBe(0);
    });
  });

  describe("nearest", () => {
    // The reason this alignment exists: centring on every tap would slide the
    // strip out from under the finger that just tapped it.
    it("leaves a fully visible chip alone", () => {
      expect(
        scrollLeftFor({ ...strip, ...chip(2), scrollLeft: 100, align: "nearest" }),
      ).toBe(100);
    });

    it("moves the minimum amount when the chip is cut off on the left", () => {
      // chip 1 starts at 51, the window starts at 100.
      expect(
        scrollLeftFor({ ...strip, ...chip(1), scrollLeft: 100, align: "nearest" }),
      ).toBe(51);
    });

    it("moves the minimum amount when the chip is cut off on the right", () => {
      // chip 6 ends at 356; a 200px window ending there starts at 156.
      expect(
        scrollLeftFor({ ...strip, ...chip(6), scrollLeft: 100, align: "nearest" }),
      ).toBe(156);
    });

    it("still clamps into the scrollable range", () => {
      expect(
        scrollLeftFor({ ...strip, ...chip(9), scrollLeft: 500, align: "nearest" }),
      ).toBe(310);
    });
  });
});

describe("nextIndex", () => {
  it("steps one chip at a time", () => {
    expect(nextIndex(4, "ArrowRight", 10)).toBe(5);
    expect(nextIndex(4, "ArrowLeft", 10)).toBe(3);
  });

  // Not a wrap: arrowing off Week 1 onto Week 18 would fling the scroller the
  // whole way across, which reads as a glitch rather than as navigation.
  it("clamps at the ends instead of wrapping", () => {
    expect(nextIndex(0, "ArrowLeft", 10)).toBe(0);
    expect(nextIndex(9, "ArrowRight", 10)).toBe(9);
  });

  it("jumps to the ends", () => {
    expect(nextIndex(4, "Home", 10)).toBe(0);
    expect(nextIndex(4, "End", 10)).toBe(9);
  });

  // null is the signal not to preventDefault, so Tab still leaves the strip and
  // Up/Down still scroll the page.
  it("declines keys that aren't its own", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "a"]) {
      expect(nextIndex(4, key, 10)).toBeNull();
    }
  });

  it("declines an empty strip", () => {
    expect(nextIndex(0, "ArrowRight", 0)).toBeNull();
  });

  // The selection can drop out from under the strip — `practice` going null
  // retires every "pre:N" option while one is still selected.
  it("starts from the top when the current index is out of range", () => {
    expect(nextIndex(-1, "ArrowRight", 10)).toBe(1);
    expect(nextIndex(99, "ArrowLeft", 10)).toBe(0);
  });
});

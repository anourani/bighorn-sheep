import { describe, expect, it } from "vitest";
import { hexToRgb, stripGradient } from "./pick-hero";

describe("stripGradient", () => {
  // The value in the design, spelled out: Bengals #FB4F14 is rgb(251,79,20).
  it("ramps the team colour from 25% to 80% down the strip", () => {
    expect(stripGradient("#FB4F14", "down")).toBe(
      "linear-gradient(180deg, rgba(251,79,20,0.25) 0%, rgba(251,79,20,0.8) 100%)",
    );
  });

  it("reverses the ramp for the middle strip", () => {
    expect(stripGradient("#FB4F14", "up")).toBe(
      "linear-gradient(180deg, rgba(251,79,20,0.8) 0%, rgba(251,79,20,0.25) 100%)",
    );
  });

  // Both directions span the same two alphas, so the three strips are one
  // family and not two different washes that happen to sit side by side.
  it("uses the same endpoints in both directions", () => {
    const alphas = (css: string) => [...css.matchAll(/,([\d.]+)\)/g)].map((m) => m[1]).sort();
    expect(alphas(stripGradient("#0085CA", "down"))).toEqual(alphas(stripGradient("#0085CA", "up")));
  });

  // A pure-black team is the extreme the fixed ramp was accepted for: no
  // lightening, so the strip runs grey to near-black.
  it("gives a black team the same treatment as any other", () => {
    expect(stripGradient("#000000", "down")).toBe(
      "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.8) 100%)",
    );
  });
});

describe("hexToRgb", () => {
  it("reads six-digit hex", () => {
    expect(hexToRgb("#FFB612")).toEqual([255, 182, 18]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("expands three-digit hex", () => {
    expect(hexToRgb("#0AF")).toEqual([0, 170, 255]);
  });

  it("does not require the leading hash", () => {
    expect(hexToRgb("FB4F14")).toEqual([251, 79, 20]);
  });
});

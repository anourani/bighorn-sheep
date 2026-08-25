import { describe, expect, it } from "vitest";
import { raiseToast, releaseMessage, TOAST_DURATION_MS, TOAST_EXIT_BACKSTOP_MS } from "./toast";

describe("releaseMessage", () => {
  it("names the team and the week it came off", () => {
    expect(releaseMessage("Bengals", "Week 10")).toBe("Bengals deselected as Week 10 pick.");
  });

  // The label, not the number: a practice release must not claim a regular week.
  it("speaks the practice round in its own words", () => {
    expect(releaseMessage("Chiefs", "Preseason 2")).toBe(
      "Chiefs deselected as Preseason 2 pick.",
    );
  });
});

describe("raiseToast", () => {
  it("starts at 1", () => {
    expect(raiseToast(null, "a")).toEqual({ id: 1, text: "a" });
  });

  /**
   * The whole reason for the id. Two identical releases in a row produce the
   * same sentence, and a component keyed on text alone would not replay its
   * entrance — the second one would look like nothing happened at all.
   */
  it("gives an identical message a new identity", () => {
    const first = raiseToast(null, "Bengals deselected as Week 10 pick.");
    const second = raiseToast(first, "Bengals deselected as Week 10 pick.");

    expect(second.text).toBe(first.text);
    expect(second.id).not.toBe(first.id);
  });
});

describe("timings", () => {
  // The backstop has to outlast the exit, or it fires mid-animation and the
  // toast disappears with a jump instead of sliding away.
  it("keeps the unmount backstop longer than the exit it covers", () => {
    expect(TOAST_EXIT_BACKSTOP_MS).toBeGreaterThan(280);
    expect(TOAST_DURATION_MS).toBeGreaterThan(TOAST_EXIT_BACKSTOP_MS);
  });
});

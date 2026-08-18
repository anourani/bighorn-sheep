import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("drops the decimals on a whole number of dollars", () => {
    expect(formatMoney(2000)).toBe("$20");
    expect(formatMoney(100)).toBe("$1");
    expect(formatMoney(2100)).toBe("$21");
  });

  it("prints cents when there are any", () => {
    expect(formatMoney(2150)).toBe("$21.50");
    expect(formatMoney(2105)).toBe("$21.05");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0");
  });

  it("puts the sign outside the dollar mark", () => {
    expect(formatMoney(-500)).toBe("-$5");
  });

  it("is total-safe: the parts and the sum format consistently", () => {
    const buyIn = 2000;
    const fee = 100;
    expect(formatMoney(buyIn + fee)).toBe("$21");
    expect(`${formatMoney(buyIn)} buy in + ${formatMoney(fee)} site fee`).toBe(
      "$20 buy in + $1 site fee",
    );
  });
});

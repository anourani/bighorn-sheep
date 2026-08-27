import { describe, expect, it } from "vitest";
import { buyInView } from "./league-dues";

function view(over: Partial<Parameters<typeof buyInView>[0]> = {}) {
  return buyInView({
    buyInCents: 2000,
    siteFeeCents: 100,
    buyInPaid: false,
    buyInPaidAt: null,
    ...over,
  });
}

describe("buyInView", () => {
  it("totals the stake and the fee", () => {
    expect(view().total).toBe("$21");
  });

  it("breaks the total down into its two parts", () => {
    expect(view().breakdown).toBe("$20 buy in + $1 site fee");
  });

  it("drops the breakdown when there is no fee", () => {
    const v = view({ siteFeeCents: 0 });
    expect(v.total).toBe("$20");
    expect(v.breakdown).toBeNull();
  });

  it("keeps the total and the breakdown in agreement on odd amounts", () => {
    const v = view({ buyInCents: 2550, siteFeeCents: 125 });
    expect(v.total).toBe("$26.75");
    expect(v.breakdown).toBe("$25.50 buy in + $1.25 site fee");
  });

  it("labels the badge from the paid flag", () => {
    expect(view({ buyInPaid: false }).badge).toBe("Unpaid");
    expect(view({ buyInPaid: true }).badge).toBe("Paid");
  });

  it("passes the timestamp through, including when there isn't one", () => {
    expect(view({ buyInPaidAt: "2026-10-21T16:00:00Z" }).updatedIso).toBe(
      "2026-10-21T16:00:00Z",
    );
    expect(view().updatedIso).toBeNull();
  });

  it("carries a timestamp on an unpaid membership", () => {
    // 0010's whole point: 0007 nulled the column on the unpaid branch, so the
    // one state that most wants a date was the one that could never have one.
    const v = view({ buyInPaid: false, buyInPaidAt: "2026-10-21T16:00:00Z" });
    expect(v.badge).toBe("Unpaid");
    expect(v.updatedIso).toBe("2026-10-21T16:00:00Z");
  });
});

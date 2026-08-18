// Relative, not the `@/` alias: there is no vitest config in this repo, so the
// alias does not resolve when `common-good.test.ts` imports this module. Every
// other tested module under src/components does the same.
import { formatMoney } from "../../lib/money";

/**
 * Everything the buy-in card needs to render, derived in one place.
 *
 * Extracted from the component for the reason `pick-hero.ts` and `team-grid.ts`
 * were: this repo has no component-rendering harness — no testing-library, no
 * jsdom — so logic that can be got wrong lives in a plain module beside the
 * `.tsx` and is unit-tested there.
 *
 * It is also the only place the total and the breakdown are computed, which is
 * the point: "$21" and "$20 buy in + $1 site fee" have to agree, and they only
 * do if one function produces both.
 */
export interface BuyInView {
  /** The whole stake — "$21". */
  total: string;
  /**
   * How it splits — "$20 buy in + $1 site fee" — or null when there is no fee to
   * break out. An admin who zeroes the fee should see "$20", not
   * "$20 buy in + $0 site fee" restating the number above it.
   */
  breakdown: string | null;
  paid: boolean;
  /** The badge's word. Uppercase in the design, and uppercased in CSS, not here. */
  badge: "Paid" | "Unpaid";
  /**
   * The timestamp behind "Updated 10/21", or null when nothing has been recorded
   * for this membership.
   *
   * Null is a real state, not a bug: 0007 stored the stamp only on the paid
   * branch and nulled it on the unpaid one, and 0010 widened that to record every
   * change. A membership nobody has toggled since 0010 was applied still reads
   * null, and the card drops the line rather than inventing a date for it.
   */
  updatedIso: string | null;
}

export function buyInView(input: {
  buyInCents: number;
  siteFeeCents: number;
  buyInPaid: boolean;
  buyInPaidAt: string | null;
}): BuyInView {
  const { buyInCents, siteFeeCents } = input;
  return {
    total: formatMoney(buyInCents + siteFeeCents),
    breakdown:
      siteFeeCents > 0
        ? `${formatMoney(buyInCents)} buy in + ${formatMoney(siteFeeCents)} site fee`
        : null,
    paid: input.buyInPaid,
    badge: input.buyInPaid ? "Paid" : "Unpaid",
    updatedIso: input.buyInPaidAt,
  };
}

/**
 * Money formatting for the account page's buy-in card.
 *
 * The schema stores cents (`groups.buy_in_cents`, `groups.site_fee_cents` —
 * migration 0010), because an integer cannot drift the way a float does. This is
 * the only place that turns one into a string, so the card's total and its
 * "$20 buy in + $1 site fee" breakdown can never disagree about rounding.
 */

/**
 * `2000` → `"$20"`, `2150` → `"$21.50"`, `0` → `"$0"`.
 *
 * Whole dollars drop the `.00`: every real amount in this league is round, and
 * "$21.00" beside "$20.00 buy in + $1.00 site fee" is three decimal points of
 * noise for information nobody needs. Cents are printed when they exist, so the
 * shortening can never hide part of the price.
 *
 * A negative can't reach here — the column has a `>= 0` check constraint and
 * `set_group_buy_in` raises `bad_amount` — but it formats as `-$5` rather than
 * `$-5` if one ever does, which is at least readable.
 */
export function formatMoney(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return remainder === 0
    ? `${sign}$${dollars}`
    : `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}

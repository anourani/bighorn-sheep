import { HeaderNav } from "./HeaderNav";
import { viewerBuyInUnpaid } from "@/lib/league/load";

/**
 * The app shell header — 70px of chrome carrying the app's navigation **from
 * `lg` up**, and hidden outright below it.
 *
 * It is a positioning wrapper and nothing else now. `HeaderNav` draws the whole
 * of it: a pill floating at the top of the shell holding the app's mark and the
 * three destinations. This element contributes the sticky behaviour, the z-tier
 * and the `lg` boundary.
 *
 * **No background and no blur**, which is a change. The bar used to fill itself
 * with the page colour at 12% behind a 4px blur; the design now gives the pill
 * its own white fill, border and shadow and leaves everything around it
 * transparent — so page content scrolls through the gutters beside the pill and
 * disappears behind it. That is the same floating-pill reading `BottomTabBar`
 * takes at the other edge of a phone.
 *
 * The mobile design has no header at all: `BottomTabBar` carries the same three
 * destinations at the foot of the screen and the top of the page goes back to
 * the content. So the app DOES have navigation in two places, deliberately —
 * and they are mutually exclusive by width, which is what keeps two
 * `aria-label="Primary"` landmarks from ever being exposed at once. `top-0 z-30`
 * is shared with `PickStickyBar` for the same reason: that one is `lg:hidden`
 * and exists precisely because this is gone below `lg`, so the two never draw
 * together.
 *
 * The `LeagueSwitcher` that once sat here is gone for an unrelated reason: this
 * season there is only one league, so the control disclosed a single
 * already-selected option. The account page does not switch leagues either — its
 * league card is a read-only summary — so nothing in the app calls
 * `selectLeague` today; `resolveActiveGroupId` falls back to the earliest-joined
 * membership, which with one league is the same answer.
 *
 * The survivor tally that once stacked underneath is `StatusReport`, rendered by
 * Standings; it is a *reading* of the league, which is page content.
 *
 * The header reads **one** thing about the league, and is `async` for it: whether
 * the viewer owes the buy-in, which is what puts the red dot on the account
 * button. `viewerBuyInUnpaid()` is one indexed read of the viewer's own
 * membership rows, `cache()`d per request, and it fails closed — and
 * `app/layout.tsx` already makes the same call for `BottomTabBar`, so this one
 * costs nothing and the two dots can never disagree.
 */
export async function AppHeader() {
  const buyInUnpaid = await viewerBuyInUnpaid();

  return (
    /* `hidden … lg:block` is the whole of the mobile story in this file, and
       hiding in CSS rather than branching is forced: the viewport is unknown on
       the server. The cost is that this markup and `HeaderNav`'s client JS still
       ship to a phone that never draws them.

       `pointer-events-none` HERE, on the element that actually spans the shell —
       `HeaderNav` re-enables them on the pill. This is beyond the design, which
       has no opinion about it, and it exists because the bar is transparent now:
       it covers the full 1000px while only its middle ~400px is drawn, so
       without this it swallows clicks across ~600px of what looks like ordinary
       page content scrolling past underneath. That is `Toast`'s reasoning — a
       full-width positioner around a small card — rather than `PickStickyBar`'s,
       which swallows taps precisely because it IS the full-width opaque surface.

       It has to be on this element and not on the row inside it: `elementFromPoint`
       in the gutter returned this `<header>` when only the row opted out, because
       a parent still receives what its `none` child declines. Measured, after the
       first attempt put it one level too deep. Keyboard access is unaffected. */
    <header className="pointer-events-none sticky top-0 z-30 hidden lg:block">
      <HeaderNav buyInUnpaid={buyInUnpaid} />
    </header>
  );
}

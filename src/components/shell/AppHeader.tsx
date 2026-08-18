import Link from "next/link";
import { HeaderNav } from "./HeaderNav";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/app";
import { viewerBuyInUnpaid } from "@/lib/league/load";

/**
 * The app shell header — 62px of chrome carrying all of the app's navigation.
 *
 * Three blocks on one row: the app's mark and initials on the left, the tab pill
 * centred on the shell, and the account button on the right. It is one row at
 * every width; below 480px the wordmark drops and the mark stands alone, which
 * is what keeps a 360px viewport from overflowing.
 *
 * Two things used to live here and no longer do. The bottom `TabBar` folded into
 * the pill, so the app no longer has navigation in two places. And the
 * `LeagueSwitcher` is gone with it: this season there is only one league, so the
 * control disclosed a single already-selected option. The account page does not
 * switch leagues either — its league card is a read-only summary — so nothing in
 * the app calls `selectLeague` today; `resolveActiveGroupId` falls back to the
 * earliest-joined membership, which with one league is the same answer.
 *
 * The survivor tally that once stacked underneath is `StatusReport`, rendered by
 * Standings; it is a *reading* of the league, which is page content.
 *
 * The header reads **one** thing about the league, and is `async` for it: whether
 * the viewer owes the buy-in, which is what puts the red dot on the account
 * button. It was a plain synchronous component that read nothing until then, and
 * giving that up was weighed rather than waved through — `viewerBuyInUnpaid()` is
 * one indexed read of the viewer's own membership rows, `cache()`d per request,
 * and it fails closed. The alternative, threading the flag down from each page,
 * would have put the header's own state in three page components and left the
 * fourth free to forget it.
 */
export async function AppHeader() {
  const buyInUnpaid = await viewerBuyInUnpaid();

  return (
    /*
      Transcribed from the design's logged-in variant, which drops the bottom
      rule the signed-out header keeps and fills the bar with #FDFDFD — the page
      colour, the `bg` token — at 12% behind a 4px blur. Two things about that
      string are easy to get wrong:

        - `bg-bg/[0.12]`, not `bg-bg/12`. 12 is not on Tailwind's opacity scale,
          so the bare form compiles to nothing at all and the bar goes fully
          transparent. The bug presents as "the blur is broken".
        - `backdrop-blur-sm` *is* 4px. The `backdrop-blur-md` this replaces is
          12px. No arbitrary value needed for a number that has a token.

      The trade this makes is real and was chosen, not overlooked. At rest the
      design is exactly right: 12% of the page colour over the page colour is the
      page colour. Scrolled, this is a near-transparent bar with no rule under
      it, so standings rows and cards pass visibly behind the wordmark — the pill
      and the account button carry their own opaque fills, so the labels stay
      legible, but the wordmark is exposed — and `backdrop-filter` clamps its
      samples at the element bounds, which leaves a faint blurred/sharp seam
      along the bottom edge with no border left to hide it. Both are the design
      as drawn. The one-line undo, if it reads badly against real content, is
      `bg-bg/85`.

      `sticky top-0 z-30` stays: that is behaviour, and a still frame has no
      opinion about it.
    */
    <header className="sticky top-0 z-30 bg-bg/[0.12] backdrop-blur-sm">
      {/* 8 + 50 + 4 = 62px, falling out of the 50px mark rather than being
          hardcoded — the pill grew from 44px to 48px with the taller chips and
          is still the shorter of the two. See HeaderNav for why the pill's
          neighbours are `flex-1`. */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-2">
        <Link
          href="/app"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control"
          // The visible text is an acronym, so the accessible name spells the
          // app out. This also stops the mark and the wordmark being announced
          // as two things.
          aria-label={`${APP_NAME} — home`}
        >
          {/*
            A plain <img>, not next/image. `Avatar`'s documented reason (avoiding
            remotePatterns) doesn't apply to a local file, so the honest ones
            are: next/image would put the app's most visible above-the-fold
            element behind the image-optimisation endpoint on every
            authenticated screen, and the saving on a 50px mark is single-digit
            kilobytes.

            bg-shell-line mirrors the design's own `url(.jpg), #D9D9D9`, and is
            now only the fallback it was always meant to be: the real photograph
            HAS landed (a 150×150 JPEG, committed in b9b4e1c), so the grey no
            longer shows. The note that used to sit here saying the asset was
            still a flat grey square outlived the file that made it true. alt is
            empty because the image is decorative, and the width/height
            attributes reserve the box so swapping the asset can't shift layout.

            `max-w-none` is load-bearing and is NOT cosmetic. Tailwind's preflight
            sets `img { max-width: 100% }`, which outranks `w-[50px]` and beats
            `shrink-0` — the cap is on the used width, not on flex shrinking. This
            link is `flex-1` from a zero basis, so on a phone its box is the ~47px
            rail rather than its 50px of content, and without `max-w-none` the
            mark silently rendered 47 × 50: an `object-cover` crop, not a shrink,
            so it reads as a slightly wrong photograph rather than a layout bug.
            (It got worse the narrower you went — 14px at 320.) With the cap off,
            the mark keeps its 50px and overruns the rail *into the row's gap*,
            which is what HeaderNav's arithmetic assumes and what leaves 4px of
            clearance at the design's own 358px mobile frame.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={50}
            height={50}
            className="h-[50px] w-[50px] max-w-none shrink-0 rounded-[4px] bg-shell-line object-cover"
          />
          {/* Hidden below 480px, up from 430: the design's full-width chips took
              17px off each rail, so the 104px this block needs (50 mark + 12 gap
              + ~42 of "SWG") now arrives at rail = 104, i.e. a 474px viewport.
              It is the only one of the row's four elements carrying no
              destination of its own, so it is the one that goes.

              The breakpoint matters more than it looks: `truncate` plus the
              `min-w-0` above mean a rail that is merely *short* renders "S…"
              rather than overflowing — a silent failure that reads as a design
              choice. `truncate` stays as the backstop for the 474–480 sliver,
              the same trade `LandingHeader` documents for its own. */}
          <span className="hidden truncate text-lg font-semibold leading-[1.2] text-shell-ink min-[480px]:block">
            {APP_SHORT_NAME}
          </span>
        </Link>

        <HeaderNav buyInUnpaid={buyInUnpaid} />
      </div>
    </header>
  );
}

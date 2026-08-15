import Link from "next/link";
import { HeaderNav } from "./HeaderNav";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/app";

/**
 * The app shell header — 62px of chrome carrying all of the app's navigation.
 *
 * Three blocks on one row: the app's mark and initials on the left, the tab pill
 * centred on the shell, and the account button on the right. It is one row at
 * every width; below 430px the wordmark drops and the mark stands alone, which
 * is what keeps a 360px viewport from overflowing.
 *
 * Two things used to live here and no longer do. The bottom `TabBar` folded into
 * the pill, so the app no longer has navigation in two places. And the
 * `LeagueSwitcher` is gone with it: this season there is only one league, so the
 * control disclosed a single already-selected option. The account page does not
 * switch leagues either — its league card is a read-only summary — so nothing in
 * the app calls `selectLeague` today; `resolveActiveGroupId` falls back to the
 * earliest-joined membership, which with one league is the same answer. The
 * header consequently reads no league data at all, which is why it is a plain
 * (not `async`) Server Component — it costs nothing and cannot fail.
 *
 * The survivor tally that once stacked underneath is `LeagueStatusBar`, rendered
 * by Standings; it is a *reading* of the league, which is page content.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-shell-line bg-white/85 backdrop-blur-md">
      {/* 8 + 50 + 4 = 62px, falling out of the 50px mark rather than being
          hardcoded. See HeaderNav for why the pill's neighbours are `flex-1`. */}
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

            bg-shell-line mirrors the design's own `url(.jpg), #D9D9D9`: the
            committed asset is still a flat grey square (the real photograph has
            never landed), so today that background IS the mark. When the real
            file replaces it nothing here changes. alt is empty because the image
            is decorative, and the width/height attributes reserve the box so
            swapping the asset can't shift the layout.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={50}
            height={50}
            className="h-[50px] w-[50px] shrink-0 rounded-[4px] bg-shell-line object-cover"
          />
          {/* Hidden below 430px: the mark, both chips and the account button
              already fill a 360px row, and this is the only one of the four that
              carries no destination of its own. */}
          <span className="hidden truncate text-lg font-semibold leading-[1.2] text-shell-ink min-[430px]:block">
            {APP_SHORT_NAME}
          </span>
        </Link>

        <HeaderNav />
      </div>
    </header>
  );
}

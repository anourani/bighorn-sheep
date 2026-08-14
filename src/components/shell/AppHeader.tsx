import Link from "next/link";
import { LeagueSwitcher } from "./LeagueSwitcher";
import { APP_NAME } from "@/lib/app";
import { loadLeague } from "@/lib/league/load";

/**
 * The app shell header — 68px of chrome and nothing else.
 *
 * Left is the app's own identity: a mark and {@link APP_NAME}, constant in
 * every league. Right is the league, labelled and switchable. The survivor
 * tally that used to be stacked underneath is now `LeagueStatusBar`, rendered
 * by each page — it is a *reading* of the league at this moment, which is page
 * content, and pinning it to the viewport spent a quarter of a phone screen on
 * a number that never changes as you scroll.
 *
 * There is no longer a separate "minimal" header for a player in no league:
 * under this design the left block doesn't touch league data, so the two
 * headers had identical left halves. It is now the left block always, plus the
 * right block only when there's an active league.
 *
 * Server Component: it shares the request-memoized `loadLeague()` with the page
 * body and with `LeagueStatusBar`, so all three cost one round-trip between
 * them.
 */
export async function AppHeader() {
  const load = await loadLeague();
  const league = load.kind === "ok" ? load.data : null;

  return (
    <header className="sticky top-0 z-30 border-b border-shell-line bg-white/85 backdrop-blur-md">
      {/* 16 + 40 + 12 = 68px, falling out of the 40px mark rather than being
          hardcoded. `items-start` so the right column hangs from the top edge
          alongside the mark rather than centring against it. */}
      <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4">
        <Link
          href="/app"
          className="flex min-w-0 items-center gap-3 rounded-control"
          aria-label={`${APP_NAME} — home`}
        >
          {/*
            A plain <img>, not next/image. `Avatar`'s documented reason (avoiding
            remotePatterns) doesn't apply to a local file, so the honest ones
            are: next/image would put the app's most visible above-the-fold
            element behind the image-optimisation endpoint on every
            authenticated screen, and the saving on a 40px mark is single-digit
            kilobytes.

            bg-shell-line mirrors the design's own `url(.jpg), #D9D9D9`: if the
            asset is missing the grey square shows, with no broken-image icon
            (alt is empty, so the image is decorative) and no layout shift (the
            width/height attributes reserve the box). The visible app name inside
            this same link already names the destination.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-[4px] bg-shell-line object-cover"
          />
          <span className="truncate text-lg font-semibold leading-[1.2] text-shell-ink">
            {APP_NAME}
          </span>
        </Link>

        {/* No league: the block is omitted entirely rather than showing a
            "LEAGUE / none" placeholder — the body already renders
            `NoLeagueState`, which says so in the right place. */}
        {league ? (
          <LeagueSwitcher leagues={league.leagues} activeId={league.group.id} />
        ) : null}
      </div>
    </header>
  );
}

import { redirect } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { accountClosed, viewerBuyInUnpaid } from "@/lib/league/load";

/**
 * The authenticated shell is per-user (it reads the Supabase session from
 * cookies), so it must always render on request — never be statically
 * prerendered. This cascades to every /app route.
 */
export const dynamic = "force-dynamic";

/**
 * The one choke point for the account-closure lockout.
 *
 * A player who deletes their account keeps everything: profile, membership,
 * picks, and their line on the standings board. What they lose is access, and
 * this is where that is enforced — one small primary-key lookup gating every
 * /app route at once, rather than the same check repeated in three page
 * components where the fourth would eventually forget it.
 *
 * `middleware.ts` cannot do this job: it runs on the Edge with only the session
 * cookie, and adding a database round-trip there would tax every asset request
 * for a check that only matters inside the product. It also only bounces
 * signed-in visitors off `/` and `/login`, which is why `/account-closed` stays
 * reachable while the session is still live.
 *
 * `accountClosed()` fails open on any error — see its docblock. An unapplied
 * 0010 must not lock the whole league out.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (await accountClosed()) redirect("/account-closed");

  // Read after the redirect, so a closed account never pays for it. This is the
  // same `cache()`d, one-indexed-read call `AppHeader` makes for its own dot, so
  // the two cost one query between them and can never disagree — and it fails
  // closed, so an error hides the dot in both places at once.
  const buyInUnpaid = await viewerBuyInUnpaid();

  return (
    /* `pt-[env(safe-area-inset-top)]` is a consequence of `AppHeader` being
       hidden below `lg`, not decoration. The root layout sets
       `viewportFit: "cover"` with `statusBarStyle: "black-translucent"` and the
       manifest is `display: standalone`, so in an installed PWA the page runs
       UNDER the status bar — and with no header left to absorb it on a phone,
       `main`'s 40px would be the only clearance. The inset resolves to 0 in a
       desktop or mobile browser, so the measurement below is unchanged there,
       and `lg:pt-0` keeps desktop byte-identical. Preflight's global
       `border-box` puts this padding inside `min-h-dvh`, so it adds no scroll. */
    <div className="relative mx-auto flex min-h-dvh max-w-shell flex-col pt-[env(safe-area-inset-top)] lg:pt-0">
      <AppHeader />
      {/* The page rhythm, straight off the mockups: 40px above the first block
          and 80px below the last on a phone, 80/128 from `lg`.

          THE DESKTOP COLUMN IS THE WHOLE SHELL. `px-4 lg:px-0` — 16px of inset
          on a phone and none at all from `lg`, where the content column is the
          full 1000px of `max-w-shell` rather than 968. The standings mock-ups
          (`4082:139343`, `4158:150123`) draw every block flush to the shell at
          desktop and inset by 16 on a phone, and that was taken as the app's
          frame rather than as one page's, so Picks and Account get it too.

          What that costs, stated because it is easy to miss: `TeamGrid`'s
          desktop cards were sized against the old 968 and are 160px now, not
          154.66. Its own comment carries the new number.

          `px-4` is still a separate contract from the vertical, and it still
          must not move with it: Headcount no longer bleeds, but StandingsGrid,
          WeekStrip and TeamGrid all cancel that inset with `-mx-4` below `lg`.
          They stop at `lg` (`lg:mx-0`), which is exactly where the inset itself
          now stops, so dropping it there reaches none of them. Nothing cancels
          the vertical padding — there is no `-mt-*` anywhere in src/ — so the
          two can still be reasoned about apart.

          Historical note, since the number has now moved twice: this was `pb-28`
          while a fixed bottom tab bar sat over the page, then `pb-12` once
          navigation folded into the header. Neither was a design value.

          A bottom bar is back below `lg` and the number did NOT have to move a
          third time, which is the whole reason `BottomTabBar` is sticky rather
          than fixed: it reserves its own height at the foot of the document, so
          the 80px here is still the gap between the last block and the chrome
          rather than a guess at how much to hide behind. That held when the bar
          grew from 64px to 70, which is the point of reserving rather than
          overlaying. */}
      <main className="flex-1 px-4 pb-20 pt-10 lg:px-0 lg:pb-32 lg:pt-20">{children}</main>
      {/* Last child, and that is not a free ordering — `sticky bottom-0` works
          because this element's flow position is the foot of the document. */}
      <BottomTabBar buyInUnpaid={buyInUnpaid} />
    </div>
  );
}

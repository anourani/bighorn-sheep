import { redirect } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { accountClosed } from "@/lib/league/load";

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

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-shell flex-col">
      <AppHeader />
      {/* The page rhythm, straight off the mockups: 40px above the first block
          and 80px below the last on a phone, 64/128 from `lg`. The desktop pair
          looks lopsided written down and isn't — the mockup pads its section by
          64 and then pads the page wrapper by another 64, so the foot of the
          page is deliberately twice its head.

          `px-4` is a separate contract and must not move with these: StatusReport,
          StandingsGrid, WeekStrip and TeamGrid all full-bleed by cancelling it
          with `-mx-4`. Nothing cancels the vertical padding — there is no `-mt-*`
          anywhere in src/ — so the two can be reasoned about apart.

          Historical note, since the number has now moved twice: this was `pb-28`
          while a fixed bottom tab bar sat over the page, then `pb-12` once
          navigation folded into the header. Neither was a design value. */}
      <main className="flex-1 px-4 pb-20 pt-10 lg:pb-32 lg:pt-16">{children}</main>
    </div>
  );
}

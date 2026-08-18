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
      {/* pb-12, not the pb-28 this had while a fixed bottom tab bar sat over the
          page. All navigation is in the header now, so the only job left for the
          bottom padding is to keep the last row off the viewport edge. */}
      <main className="flex-1 px-4 pb-12 pt-5">{children}</main>
    </div>
  );
}

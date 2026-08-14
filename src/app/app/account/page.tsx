import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/league/load";
import { AccountClient } from "@/components/account/AccountClient";
import { LeagueStatusBar } from "@/components/app/LeagueStatusBar";

/**
 * Account. Server Component: loads the viewer's profile and every league they
 * belong to (not just the active one), then renders the interactive screen.
 */
export default async function AccountPage() {
  const account = await loadAccount();
  if (!account) redirect("/login");
  // The bar costs nothing here: `AppHeader` already calls the cache()d
  // `loadLeague()` on every /app request, and it renders null with no league.
  return (
    <>
      <LeagueStatusBar />
      <AccountClient account={account} />
    </>
  );
}

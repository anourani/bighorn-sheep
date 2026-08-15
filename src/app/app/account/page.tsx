import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/league/load";
import { AccountClient } from "@/components/account/AccountClient";

/**
 * Account. Server Component: loads the viewer's profile and every league they
 * belong to (not just the active one), then renders the interactive screen.
 *
 * No `StatusReport` here, unlike Standings. This screen is about the player, not
 * the league's state this week, and the design gives the page its own centred
 * title — a week/survivors band above it would be reading from a different page.
 */
export default async function AccountPage() {
  const account = await loadAccount();
  if (!account) redirect("/login");
  return <AccountClient account={account} />;
}

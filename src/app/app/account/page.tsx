import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/league/load";
import { AccountClient } from "@/components/account/AccountClient";

/**
 * Account. Server Component: loads the viewer's profile and every league they
 * belong to (not just the active one), then renders the interactive screen.
 */
export default async function AccountPage() {
  const account = await loadAccount();
  if (!account) redirect("/login");
  return <AccountClient account={account} />;
}

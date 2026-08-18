import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/league/load";
import { AccountClient } from "@/components/account/AccountClient";

export default async function AccountPage() {
  const account = await loadAccount();
  if (!account) redirect("/login");
  // Resolved here rather than in the client. `MoreSection` hides the invite row
  // once entry closes, and a `new Date()` during render is a hydration mismatch
  // waiting for someone to load the page across that deadline.
  return <AccountClient account={account} now={new Date().toISOString()} />;
}

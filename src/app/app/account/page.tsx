import { redirect } from "next/navigation";
import { loadAccount, loadLeague } from "@/lib/league/load";
import { AccountClient } from "@/components/account/AccountClient";

export default async function AccountPage() {
  const account = await loadAccount();
  // `/`, matching what middleware already does for a signed-out visitor on any
  // /app route — this is the defence-in-depth copy of that rule, for the window
  // where a session dies between middleware's check and this one, so the two
  // must not disagree about where such a visitor belongs.
  if (!account) redirect("/");

  // The Admin Control Center row opens `AdminSettingsDrawer`, which needs the
  // league's full roster — and `loadAccount` deliberately doesn't carry one
  // (`LeagueSummary` has aliveCount/memberCount, not `Member[]`). Fetch it from
  // the canonical producer, and only for an admin: `loadLeague` is seven queries
  // against `loadAccount`'s four, and every player would otherwise pay them for
  // a row they never see.
  //
  // Null here therefore means "no control center", either way round — an
  // unresolved league, a non-admin, or a load that failed. Failing CLOSED is the
  // right side to err on for one admin control, and is the opposite of
  // `accountClosed()`, where the same error must not lock a league out.
  const active = account.leagues.find((l) => l.group.id === account.activeGroupId) ?? null;
  const load = active?.role === "admin" ? await loadLeague(active.group.id) : null;
  const adminMembers = load?.kind === "ok" ? load.data.members : null;

  // `now` is resolved here rather than in the client. `MoreSection` hides the
  // invite row once entry closes, and a `new Date()` during render is a
  // hydration mismatch waiting for someone to load the page across that deadline.
  return (
    <AccountClient
      account={account}
      adminMembers={adminMembers}
      now={new Date().toISOString()}
    />
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { EditProfileModal } from "@/components/account/EditProfileModal";
import { ProfileCard, SPEC_BUTTON } from "@/components/account/ProfileCard";
import { JoinByCode } from "@/components/account/JoinByCode";
import { LogOutIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { statusLabel } from "@/lib/league/view";
import { BUY_IN_LABEL } from "@/lib/app";
import type { AccountData, LeagueSummary } from "@/lib/league/load";

/**
 * Both the "Your League" and "Preferences" sections are hidden for now — the
 * markup below is intact, so flipping this to `true` brings them back exactly as
 * they were. Preferences was never wired up (all three rows are placeholders);
 * Your League is read-only and restates what Standings and My Picks already show
 * for the single inaugural-season league.
 *
 * This deliberately does NOT gate the way into a league. "Join an Existing
 * League" below renders whenever the viewer belongs to none, flag or no flag —
 * the two are mutually exclusive states of the same slot, so hiding the card
 * never hides the invite field.
 */
const SHOW_LEAGUE_AND_PREFERENCES = false;

/**
 * A section title on the white page.
 *
 * Deliberately not `SectionHeader`: that component's hairline *is* the
 * separation between its surface-less sections, and it is what its three other
 * callers want. Here the cards below do the separating, so the rule would be a
 * second divider 12px above the first.
 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold leading-[1.4] text-black">{children}</h2>;
}

/** One of the meta row's hairlines. Figma's "background neutral". */
function MetaRule() {
  return <span aria-hidden className="h-[21px] w-px shrink-0 bg-[#5A5A5A]" />;
}

/**
 * The viewer's membership: the league's name over their standing in it.
 *
 * Read-only, and nothing else in the app switches leagues either — the header's
 * `LeagueSwitcher` is gone too. That is deliberate on both sides: the season runs
 * a single league, so the control disclosed one already-selected option. The
 * `selectLeague` action survives unused for whenever a second league exists;
 * until then `resolveActiveGroupId` falls back to the earliest-joined membership,
 * which with one league is the same answer.
 */
function LeagueCard({ league }: { league: LeagueSummary }) {
  return (
    <div className="rounded-control border border-shell-line bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>League name</Label>
          <span className="block truncate text-lg font-semibold leading-[1.2] text-shell-ink">
            {league.group.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-[1.2] text-shell-ink">
          <span>{league.role === "admin" ? "Admin" : "Player"}</span>
          <MetaRule />
          <span>{statusLabel(league)}</span>
          <MetaRule />
          <span>Buy In {BUY_IN_LABEL}</span>
        </div>
      </div>
    </div>
  );
}

/** One row of the Preferences card. */
function PreferenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4">
      <span className="text-lg font-semibold leading-[1.2] text-shell-ink">{label}</span>
      {children}
    </div>
  );
}

export function AccountClient({ account }: { account: AccountData }) {
  const { viewer, leagues, activeGroupId } = account;
  const [editOpen, setEditOpen] = useState(false);

  const activeLeague = leagues.find((l) => l.group.id === activeGroupId) ?? null;

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Supabase not configured — just return to the sign-in screen.
    }
    window.location.href = "/login";
  }

  return (
    <>
      {/*
        One 420px column at every width. `pt-5` adds to `main`'s own `pt-5` for
        the design's 40px; its `px-16` is already `main`'s `px-4`, so it is not
        re-applied here.
      */}
      <div className="stagger mx-auto w-full max-w-[420px] space-y-5 pt-5">
        <h1 className="text-center text-[1.75rem] font-bold leading-[1.4] text-black">
          Account Details
        </h1>

        <ProfileCard viewer={viewer} phone={account.phone} onEdit={() => setEditOpen(true)} />

        {SHOW_LEAGUE_AND_PREFERENCES && activeLeague && (
          <section className="space-y-3">
            <SectionTitle>Your League</SectionTitle>
            <LeagueCard league={activeLeague} />
            <p className="px-1 text-xs leading-relaxed text-ink-mute">
              Buy-in is set by your admin —{" "}
              {activeLeague.buyInPaid ? "you're marked as paid." : "you're not marked as paid yet."}
            </p>
          </section>
        )}

        {/* The way in for someone who signed in before anyone invited them — no
            league yet, and the invite code is the only path. `joinGroup` already
            revalidates this route, and `JoinByCode` pushes to Standings on
            success, so this disappears the moment it does its job. */}
        {!activeLeague && (
          <section className="space-y-3">
            <SectionTitle>Join an Existing League</SectionTitle>
            {/* Same surface as `LeagueCard` — every section on this page is a
                title over a white card, and a bare input row was the outlier. */}
            <div className="rounded-control border border-shell-line bg-white p-4">
              <JoinByCode />
            </div>
          </section>
        )}

        {/* Preferences — placeholder surface. Nothing here is wired up yet; the
            rows exist so the shape of the settings is visible and reviewable. */}
        {SHOW_LEAGUE_AND_PREFERENCES && (
          <section className="space-y-3">
            <SectionTitle>Preferences</SectionTitle>
            {/* overflow-hidden so the dividers clip to the corner radius. */}
            <div className="divide-y divide-shell-line overflow-hidden rounded-control border border-shell-line bg-white">
              <PreferenceRow label="Notifications">
                <span className="text-sm text-ink-mute">Coming soon</span>
              </PreferenceRow>
              <PreferenceRow label="Timezone">
                <span className="text-sm text-ink-mute">Coming soon</span>
              </PreferenceRow>
              <PreferenceRow label="Add to Home Screen">
                <Button variant="outline" size="sm" className={SPEC_BUTTON} disabled>
                  Install App
                </Button>
              </PreferenceRow>
            </div>
            <p className="px-1 text-xs leading-relaxed text-ink-mute">
              Times are shown in your device timezone. To install, use{" "}
              <b className="font-semibold text-ink-soft">Add to Home Screen</b> in your
              browser&apos;s share menu — the in-app button is coming soon.
            </p>
          </section>
        )}

        <Button variant="outline" block onClick={handleLogout}>
          <LogOutIcon />
          Log out
        </Button>
      </div>

      {/* Outside `.stagger`: as a child of it, opening the sheet inherited a
          220ms entrance delay on top of the modal's own animation. */}
      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        viewer={viewer}
        currentPhone={account.phone}
      />
    </>
  );
}

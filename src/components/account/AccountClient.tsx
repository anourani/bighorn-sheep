"use client";

import { useState } from "react";
import { EditProfileModal } from "@/components/account/EditProfileModal";
import { DeleteAccountModal } from "@/components/account/DeleteAccountModal";
import { PersonalDetailsCard } from "@/components/account/PersonalDetailsCard";
import { CommonGood } from "@/components/account/CommonGood";
import { MoreSection } from "@/components/account/MoreSection";
import { SignOutButton } from "@/components/account/SignOutButton";
import { JoinByCode } from "@/components/account/JoinByCode";
import { AdminSettingsDrawer } from "@/components/group/AdminSettingsDrawer";
import { AccountSection, CARD, PAGE_TITLE } from "@/components/account/surfaces";
import { SPEC_BUTTON_DARK } from "@/components/account/spec";
import { cn } from "@/lib/cn";
import type { AccountData } from "@/lib/league/load";
import type { Member } from "@/lib/league/types";

/**
 * The account page.
 *
 * Geometry, all of it transcribed from the mock-ups rather than approximated:
 *
 * - **The column is 656px**, centred in `main`'s 968px (`max-w-shell` 1000 less
 *   its `px-4`). The two columns inside it are 322 + 12 + 322.
 * - **`lg` is where it turns over**, not `md` — the same width `PickHero`,
 *   `WeekStrip` and `StandingsGrid` change shape at, so the whole app steps at
 *   one place. Below it everything stacks full-bleed-ish at the phone's 361px.
 * - **Blocks are 32px apart on a phone and 48px on a desktop**, uniformly, in
 *   both mock-ups.
 * - **DOM order is not visual order.** The phone puts Log Out above Additional
 *   Settings; the desktop puts it below. One flex column and two `order` classes,
 *   rather than rendering the button twice and letting the two copies drift.
 *
 * `.stagger` animates `> *` on `:nth-child`, which `order` leaves alone — so the
 * entrance runs in DOM order on both, and the four children sit well inside its
 * eight defined delay slots.
 */
export function AccountClient({
  account,
  adminMembers,
  now,
}: {
  account: AccountData;
  /**
   * The active league's roster, loaded by the server component only when the
   * viewer administers it — and null otherwise. It is both the drawer's data and
   * the answer to "is this viewer an admin", so the row and the panel behind it
   * cannot disagree. See `app/account/page.tsx` for why it fails closed.
   */
  adminMembers: Member[] | null;
  now: string;
}) {
  const { viewer, leagues, activeGroupId } = account;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeLeague = leagues.find((l) => l.group.id === activeGroupId) ?? null;
  const admin = activeLeague && adminMembers ? { league: activeLeague, members: adminMembers } : null;

  // Inlined at build time and blank outside production on purpose, so a preview
  // hands out its own invite links. The drawer's invite field resolves it as
  // `appUrl || window.location.origin` — `||`, never `??`, since a blank Netlify
  // variable inlines as "" and `??` would pass it straight through.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <>
      <div className="stagger mx-auto flex w-full max-w-[656px] flex-col gap-8 lg:gap-12">
        <h1 className={cn(PAGE_TITLE, "text-center")}>Account Details</h1>

        {/* 32px apart stacked, 12px apart side by side. The mock-ups differ here
            and it is not a rounding artefact: the phone reads the two as separate
            sections of a scroll, the desktop as two columns of one block. */}
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-3">
          <PersonalDetailsCard
            viewer={viewer}
            phone={account.phone}
            onEdit={() => setEditOpen(true)}
          />

          {/* Two mutually exclusive states of the same slot. Someone who signed
              in before anyone invited them has no buy-in to owe and no league to
              be square with, so the invite field takes the column instead —
              `/app` and `/app/standings` offer the same `JoinByCode` through
              `NoLeagueState`, and three entry points is intentional. */}
          {activeLeague ? (
            <CommonGood league={activeLeague} />
          ) : (
            <AccountSection title="Join an Existing League">
              <div className={CARD}>
                <JoinByCode />
              </div>
            </AccountSection>
          )}
        </div>

        <div className="order-3 flex justify-center lg:order-4">
          <SignOutButton
            variant="ghost"
            size="lg"
            className={cn(SPEC_BUTTON_DARK, "w-full lg:w-[200px]")}
          >
            Log Out
          </SignOutButton>
        </div>

        <div className="order-4 lg:order-3">
          <MoreSection
            group={activeLeague?.group ?? null}
            isAdmin={admin !== null}
            onOpenSettings={() => setSettingsOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            now={now}
          />
        </div>
      </div>

      {/* Outside `.stagger`: as a child of it, opening a sheet inherited a 220ms
          entrance delay on top of the modal's own animation. The drawer is the
          worse case of the same bug — its own 320ms slide plays invisibly. */}
      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        viewer={viewer}
        currentPhone={account.phone}
      />
      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />

      {/* `admin ? … : null` rather than `settingsOpen && …`: the drawer holds the
          active tab in its own state and `Drawer` unmounts only its subtree when
          closed, so this component staying mounted is what makes the tab survive
          close and reopen. */}
      {admin ? (
        <AdminSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          group={admin.league.group}
          members={admin.members}
          appUrl={appUrl}
          phase={admin.league.phase}
        />
      ) : null}
    </>
  );
}

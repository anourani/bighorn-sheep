"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isEntryOpen } from "@/lib/game/season";
import { cn } from "@/lib/cn";
import { SPEC_BUTTON_LIGHT } from "./spec";
import { AccountSection, BODY, VALUE } from "./surfaces";
import type { Group } from "@/lib/league/types";

/**
 * One 64px row of the "Additional Settings" block.
 *
 * `rounded-control` (8px), where the cards above are 4px. That is the design at
 * both widths, not a slip — these read as list rows, not as cards.
 */
function MoreRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-16 items-center justify-between gap-4 rounded-control bg-fill-soft px-4">
      <span className={VALUE}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The way into `AdminSettingsDrawer` — the only one in the app, since the gear
 * on Standings came off.
 *
 * Same fill and same 8px radius as `MoreRow`, and deliberately NOT the same row:
 * `p-4` with a content-driven height rather than `h-16`, because the second line
 * of copy is what makes the mock-up's card 80px at 656 and 102px at 361. Pinning
 * a height would clip the wrap at the phone width.
 *
 * `items-start`, not `items-center`: the 40px button is shorter than the text
 * stack in both frames and the design tops them out together.
 */
function AdminControlCenterRow({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="flex items-start gap-6 rounded-control bg-fill-soft p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={VALUE}>Admin Control Center</span>
        <p className={cn(BODY, "text-shell-mute")}>Manage league settings in the control center.</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className={cn(SPEC_BUTTON_LIGHT, "min-w-[100px] shrink-0")}
        onClick={onEnter}
      >
        Enter
      </Button>
    </div>
  );
}

/**
 * "Additional Settings": run the league, share it, or leave it.
 *
 * The admin row is the only one gated on who you are; the invite row disappears
 * once entry closes, matching `InviteCta` on Standings — the code still exists
 * but `join_by_invite` refuses it, so offering it would be a dead end. That can
 * empty this section down to the Danger Zone alone for a mid-season player, which
 * is fine and is the shape it ships in.
 */
export function MoreSection({
  group,
  isAdmin,
  onOpenSettings,
  onDelete,
  now,
}: {
  /** Null when the viewer belongs to no league — then there is no code to share. */
  group: Group | null;
  /**
   * Whether to offer the control center. Resolved by `AccountClient` against the
   * roster the drawer itself needs, so the row and the panel behind it cannot
   * disagree about who is an admin.
   */
  isAdmin: boolean;
  onOpenSettings: () => void;
  onDelete: () => void;
  /**
   * Resolved by the server component, not `new Date()` here: a clock read during
   * render is a hydration mismatch waiting for someone to load the page across
   * the entry deadline.
   */
  now: string;
}) {
  const [copied, setCopied] = useState(false);
  const showInvite = group !== null && isEntryOpen(new Date(group.entryClosesAt), new Date(now));

  async function copy() {
    if (!group) return;
    // `NEXT_PUBLIC_APP_URL` is inlined at build time and is set per deploy
    // context, deliberately blank outside production so a preview hands out its
    // own links rather than production's. `||`, not `??`: a Netlify variable
    // left blank inlines as "", which `??` passes straight through — the link
    // would come out as a relative `/login?invite=...` that nobody can paste.
    const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/login?invite=${group.inviteCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — nothing to recover, and nothing to apologise for */
    }
  }

  return (
    <AccountSection title="Additional Settings">
      <div className="flex flex-col gap-3">
        {isAdmin ? <AdminControlCenterRow onEnter={onOpenSettings} /> : null}

        {showInvite ? (
          <MoreRow label="Invite Link">
            <Button
              variant="outline"
              size="sm"
              className={cn(SPEC_BUTTON_LIGHT, "min-w-[100px]")}
              onClick={copy}
              aria-label="Copy invite link"
            >
              {/* Text only, no icon — the mock-up's button is 103px and an icon
                  makes it 127. The label swap is the whole confirmation. */}
              {copied ? "Copied" : "Copy Link"}
            </Button>
          </MoreRow>
        ) : null}

        <MoreRow label="Danger Zone!!">
          {/* A button styled as the design's red link, not an <a>: it opens a
              dialog, and a link that goes nowhere is a link a keyboard user
              cannot use and a screen reader announces wrongly. */}
          <button
            type="button"
            onClick={onDelete}
            className="rounded text-[16px] font-medium leading-[1.35] tracking-[-0.16px] text-badge-due-line underline decoration-solid [text-underline-position:from-font] hover:brightness-110"
          >
            Delete Account
          </button>
        </MoreRow>
      </div>
    </AccountSection>
  );
}

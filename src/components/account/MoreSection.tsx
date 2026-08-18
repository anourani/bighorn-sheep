"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isEntryOpen } from "@/lib/game/season";
import { cn } from "@/lib/cn";
import { SPEC_BUTTON_LIGHT } from "./spec";
import { AccountSection, VALUE } from "./surfaces";
import type { Group } from "@/lib/league/types";

/**
 * One 64px row of the "More" block.
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
 * "More": share the league, or leave it.
 *
 * The invite row disappears once entry closes, matching `InviteCta` on
 * Standings — the code still exists but `join_by_invite` refuses it, so offering
 * it would be a dead end. That can empty this section down to the Danger Zone
 * alone, which is fine and is the mid-season shape.
 */
export function MoreSection({
  group,
  onDelete,
  now,
}: {
  /** Null when the viewer belongs to no league — then there is no code to share. */
  group: Group | null;
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
    // `NEXT_PUBLIC_APP_URL` is inlined at build time and is currently set to the
    // same value in every Netlify deploy context, so a preview hands out
    // production links (see CLAUDE.md). Falling back to the origin the visitor
    // is actually on is strictly better than this file's neighbours' fallback,
    // `https://bighorn.example`, which is a domain that does not exist.
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/login?invite=${group.inviteCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — nothing to recover, and nothing to apologise for */
    }
  }

  return (
    <AccountSection title="More">
      <div className="flex flex-col gap-3">
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

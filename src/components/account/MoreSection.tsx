"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { FEEDBACK_URL } from "@/lib/app";
import { isEntryOpen } from "@/lib/game/season";
import { cn } from "@/lib/cn";
import { SPEC_BUTTON_LIGHT } from "./spec";
import { AccountSection, VALUE } from "./surfaces";
import type { Group } from "@/lib/league/types";

/**
 * One 64px row of the "Additional Settings" block.
 *
 * `rounded-control` — the same 8px the cards above take. This used to be the
 * one thing on the page drawn at a different radius from them, and `surfaces.tsx`
 * carries the note about why that split went away.
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
 * "Additional Settings": share the league, say something about it, or leave it.
 *
 * The Admin Control Center used to be the first row here and is now a card at the
 * top of the page — see `AdminControlCenterCard`. Nothing left in this block is
 * gated on who you are, but the invite row still disappears once entry closes,
 * matching `InviteCta` on Standings: the code still exists but `join_by_invite`
 * refuses it, so offering it would be a dead end.
 */
export function MoreSection({
  group,
  onDelete,
  onReplayTour,
  now,
}: {
  /** Null when the viewer belongs to no league — then there is no code to share. */
  group: Group | null;
  onDelete: () => void;
  onReplayTour: () => void;
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

        {/* An `<a>`, not `Button`: this one navigates, and `Button` renders a
            `<button>` and takes no `href`. `buttonVariants()` is exported for
            exactly this, so the control is the same object as "Copy Link" beside
            it rather than a hand-matched lookalike. */}
        <MoreRow label="Say Something Nice">
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              SPEC_BUTTON_LIGHT,
              "min-w-[100px]",
            )}
          >
            Feedback
          </a>
        </MoreRow>

        {/* The tour's permanent home, and the reason skipping it costs nothing.
            Never hidden, unlike the invite row above: the invite becomes a dead
            end once `join_by_invite` starts refusing the code, whereas the rules
            this explains are worth re-reading in week twelve.

            The design draws this as a full-width button with a chevron under a
            "How to play" heading of its own. It is a `MoreRow` with a right-hand
            control here, matching the two rows beside it — that heading belongs
            to a redesign of this page that is a separate piece of work. */}
        <MoreRow label="App Tour">
          <Button
            variant="outline"
            size="sm"
            className={cn(SPEC_BUTTON_LIGHT, "min-w-[100px]")}
            onClick={onReplayTour}
          >
            Replay
          </Button>
        </MoreRow>

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

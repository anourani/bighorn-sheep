import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { SPEC_BUTTON_DARK } from "./spec";
import { BODY, VALUE } from "./surfaces";

/**
 * The way into `AdminSettingsDrawer` — the only one in the app, since the gear
 * on Standings came off.
 *
 * It sits at the very top of the account page, directly under the title and
 * above Personal Details, and it carries no section heading of its own: the
 * mock-ups draw a bare card. It is admin-only, so a typical member's page starts
 * at Personal Details with nothing above it. This used to be the first row of
 * "Additional Settings" at the foot of the page, which is why it is shaped like
 * a `MoreRow` and is not one.
 *
 * Three things are load-bearing:
 *
 * - **`p-4` with a content-driven height, not `h-16`.** The second line of copy
 *   is what makes the mock-up's card 80px at 656 and 102px at 361, where it
 *   wraps. A pinned height clips that wrap at the phone width.
 * - **`items-start` below `lg`, `items-center` from `lg`.** Figma puts the 40px
 *   button at y=20 in the 80px desktop card — centred against a subcopy that
 *   fits on one line — and at y=16 in the 102px mobile card, topped out against
 *   a subcopy that takes two. One alignment for both widths is wrong at one of
 *   them, and this file previously claimed the design "tops them out together"
 *   in both frames, which was only ever true on the phone.
 * - **The button is black.** The desktop frame draws Button/Primary where the
 *   mobile frame draws the outline control; the two mock-ups disagree and black
 *   won. `SPEC_BUTTON_DARK` on `variant="ghost"` rather than the newer `dark`
 *   variant, because that is how the page's other two black buttons are already
 *   written and one page wanting two spellings of one black is the thing
 *   `spec.ts` exists to prevent.
 */
export function AdminControlCenterCard({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-control bg-fill-soft p-4 lg:items-center">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={VALUE}>Admin Control Center</span>
        <p className={cn(BODY, "text-shell-mute")}>Manage league settings in the control center.</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={cn(SPEC_BUTTON_DARK, "h-10 min-w-[100px] shrink-0")}
        onClick={onEnter}
      >
        Enter
      </Button>
    </div>
  );
}

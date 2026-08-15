import { APP_NAME } from "@/lib/app";
import { LogInButton } from "@/components/landing/LogInButton";
import { InviteCodeButton } from "@/components/landing/InviteCodeButton";

/**
 * The landing page's chrome: the app's identity on the left, the two ways in on
 * the right.
 *
 * Mirrors `AppHeader`'s left block deliberately — same mark, same name, same
 * 16 + 40 + 12 = 68px arithmetic — so arriving at /app after signing in doesn't
 * feel like a different product. Three differences, all because this is the
 * signed-out door: the mark isn't a link (there is nowhere to go from `/`), the
 * header isn't sticky (the page is short), and it centres rather than
 * top-aligns because both children are exactly 40px tall.
 */

/*
  Not `Button variant="outline"`: that variant is h-11 with `border-line`
  (#D8DADF), `text-sm` and `font-medium`, where this design wants h-10,
  `shell-line` (#D9D9D9), 16px and 600. Reaching the spec through it would take
  four className overrides, at which point the variant contributes nothing but
  a misleading name. `rounded-control` is already the 8px the design asks for.
*/
const headerButton =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-control border " +
  "border-shell-line bg-white px-3 text-base font-semibold leading-none " +
  "text-shell-ink transition-colors hover:bg-[#F6F7F9]";

export function LandingHeader() {
  return (
    <header className="border-b border-shell-line">
      <div className="flex items-center justify-between gap-4 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {/*
            A plain <img>, not next/image — same reasoning as AppHeader, and
            bg-shell-line mirrors the design's own `url(.jpg), #D9D9D9` so a
            missing asset degrades to the grey square with no layout shift.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-[4px] bg-shell-line object-cover"
          />
          <span className="truncate text-lg font-semibold leading-[1.2] text-shell-ink">
            {APP_NAME}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <LogInButton className={headerButton} />
          <InviteCodeButton className={headerButton} />
        </div>
      </div>
    </header>
  );
}

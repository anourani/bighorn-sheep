import { APP_NAME, APP_SHORT_NAME } from "@/lib/app";
import { LogInButton } from "@/components/landing/LogInButton";
import { InviteCodeButton } from "@/components/landing/InviteCodeButton";

/**
 * The landing page's chrome: the app's identity on the left, the two ways in on
 * the right.
 *
 * Mirrors `AppHeader`'s left block deliberately — same mark, same initials, same
 * 8 + 50 + 4 = 62px arithmetic — so arriving at /app after signing in doesn't
 * feel like a different product. Two differences, both because this is the
 * signed-out door: the mark isn't a link (there is nowhere to go from `/`), and
 * the header isn't sticky (the page is short).
 *
 * It had drifted: 40px mark, the full name, 40px buttons, 16 + 40 + 12. That
 * was the header when it was written, and it is what overflowed a phone —
 * "Enter Invite Code" alone put the document 54px wider than a 375px viewport,
 * which reads not as a clipped button but as a page-wide right-hand gutter,
 * because everything else is inside a 375px column while the page scrolls 429.
 *
 * Two independent things keep that from coming back, and both are needed:
 *
 *   - The row's intrinsic width now fits. The design's mobile and desktop
 *     variants of this header are identical, and both are the compact one:
 *     36px buttons at 14px, and the initials rather than the full name.
 *   - It cannot overflow even if the copy grows. `min-w-0` on the identity
 *     block was already here and did nothing on its own: the buttons are
 *     `shrink-0`, but their CONTAINER was shrinkable, so flex handed it less
 *     room than its contents and the contents spilled out of it. `shrink-0` on
 *     that container is what forces the shrinking onto the truncatable half.
 *
 * Re-checked value by value against the design's signed-out variants when the
 * signed-in header was restyled, and it is exact — padding, rule, 50px mark,
 * 12px title gap, 18px wordmark, 8px button gap and the whole button string.
 * (The design's 1000px cap is already supplied upstream by `page.tsx`'s
 * `max-w-shell` wrapper, and its `py-[4px]` on the buttons is inert under `h-9`
 * plus `items-center`.) So the *signed-out* header intentionally has no diff.
 *
 * One thing is deliberately not transcribed: the design puts a 4px backdrop blur
 * on this header too. `AppHeader` takes it because it is sticky and page content
 * genuinely passes behind it. Nothing passes behind this one — it does not move —
 * so the only thing it could blur is `AmbientBackground`'s grid, which sits at
 * full opacity exactly here, at the top of the viewport, before its mask fades
 * downward. The result would be a 62px band of soft grid inside a page of sharp
 * grid, plus a vertical seam at each shell edge above 1000px, bought with a
 * compositing layer. If that call is ever reversed it is one class:
 * `backdrop-blur-sm`.
 */

/*
  Not `Button variant="outline"`: that variant is h-11 with `border-line`
  (#D8DADF), `text-sm` and `font-medium`, where this design wants h-9,
  `shell-line` (#D9D9D9) and 600. Reaching the spec through it would take
  four className overrides, at which point the variant contributes nothing but
  a misleading name. `rounded-control` is already the 8px the design asks for.
*/
const headerButton =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-control border " +
  "border-shell-line bg-white px-2 text-sm font-semibold leading-[1.2] " +
  "text-shell-ink transition-colors hover:bg-[#F6F7F9]";

export function LandingHeader() {
  return (
    <header className="border-b border-shell-line">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2">
        {/* No `gap-3`: the accessible name below is a zero-width absolutely
            positioned element, and a gap would still reserve 12px beside it.
            The margin rides on the wordmark instead, so it goes when it does. */}
        <div className="flex min-w-0 items-center">
          {/*
            A plain <img>, not next/image — same reasoning as AppHeader, and
            bg-shell-line mirrors the design's own `url(.jpg), #D9D9D9` so a
            missing asset degrades to the grey square with no layout shift.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt=""
            width={50}
            height={50}
            className="h-[50px] w-[50px] shrink-0 rounded-[4px] bg-shell-line object-cover"
          />
          {/* The visible text is an acronym, so the full name is what's
              announced — the same trade AppHeader makes with its `aria-label`,
              which it can use because its block is a link and this one isn't.
              This half is never hidden, so the header names the app at every
              width even where the wordmark below doesn't render. */}
          <span className="sr-only">{APP_NAME}</span>
          {/* Hidden below 360px, where the mark, the wordmark and the two
              buttons together need 346px: the acronym is the only one of the
              three carrying nothing you can act on, and `truncate` renders it
              "S." rather than dropping it. `truncate` stays as the backstop for
              the sliver between 346 and 360. */}
          <span
            aria-hidden="true"
            className="ml-3 hidden truncate text-lg font-semibold leading-[1.2] text-shell-ink min-[360px]:block"
          >
            {APP_SHORT_NAME}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LogInButton className={headerButton} />
          <InviteCodeButton className={headerButton} />
        </div>
      </div>
    </header>
  );
}

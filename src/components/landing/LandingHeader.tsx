import { APP_NAME } from "@/lib/app";
import { LogInButton } from "@/components/landing/LogInButton";
import { InviteCodeButton } from "@/components/landing/InviteCodeButton";

/**
 * The landing page's chrome: the app's mark and the two ways in, on the same
 * floating pill the signed-in app wears.
 *
 * **The mirror with `AppHeader` is deliberate again.** This docblock used to
 * argue the opposite at length — that the signed-in header had been redesigned
 * into a centred pill while this one was left alone on purpose, and not to
 * "restore" the symmetry without a signed-out frame asking for it. The
 * signed-out frames have since caught up: same white fill, same 16px radius,
 * same hairline at half opacity, same 6px shadow, same 40px circular mark. A
 * visitor who signs in now watches the pill's CONTENTS change rather than the
 * header. It is the third surface on that one card, with `BottomTabBar`.
 *
 * Three numbers still differ from `HeaderNav`, and all three come off the
 * frames rather than from drift. Don't unify them:
 *
 *   - **The row is 74px where the signed-in one is 70** — this design pads
 *     evenly above and below the pill and that one doesn't. Nothing reads
 *     either number: there is no header-height custom property, no scroll
 *     offset and nothing anchored to the header's foot anywhere in `src/`. The
 *     visible consequence is that the title block below sits 11px lower than it
 *     used to (the old header was 12 + 50 + a 1px rule = 63). That is the
 *     frame's, not a padding bug.
 *   - The pill spaces its children 12px, where the signed-in pill spaces its
 *     tabs 4px.
 *   - The buttons are the design's SMALL control — 36px at 14px semibold with
 *     8px of side padding — not its 40px/16px nav button.
 *
 * It is sticky now, and that is a behaviour change rather than a restyle: this
 * header sat in flow for as long as it existed, on the argument that the page
 * is short. The page is not short — it carries the league's status band and the
 * whole standings table — and the design draws a floating pill, which only
 * reads as floating if something passes behind it.
 *
 * **`Modal` does not portal, and three things below follow from that.** Both
 * button components return a fragment of a `<button>` and a `Modal`, and
 * `Modal` renders a bare full-viewport `position: fixed` div — so the dialog is a DOM
 * descendant of the pill rather than of `document.body`, the way `Drawer` and
 * `Toast` are:
 *
 *   - **The shadow must stay a `box-shadow`.** Figma draws it as a
 *     shadow with a CSS filter, and on an opaque rounded rectangle the two are
 *     indistinguishable — but a `filter` makes its element a containing block
 *     for `fixed` descendants, which would pin the login dialog inside this
 *     58px pill. `HeaderNav` refuses the filter for the weaker version of this
 *     reason (it has no fixed descendant); here it is a real bug, and there is
 *     a test for it.
 *   - **`pointer-events` reaches the dialog by INHERITANCE.** The header takes
 *     `none` so clicks fall through the dead band beside the pill; the pill
 *     takes `auto`; the dialog inherits `auto` from the pill. Moving the modals
 *     up to the header to "tidy" the tree would leave them inheriting `none` —
 *     a full-screen dialog nobody can click, with nothing in the console.
 *   - Sticky plus a z-index makes this header a stacking context, so the
 *     dialog now resolves its own stacking level INSIDE it. Harmless today: nothing else on
 *     `/` stacks above level 20 (`StandingsGrid`’s sticky first column), and the
 *     landing wrapper is not positioned, so everything else compares in the
 *     root context. It becomes a trap the day something on `/` wants a higher one.
 *
 * The dead band is why the pointer-events pair is load-bearing at all, and it
 * is the same trade `AppHeader` documents: the band spans the full 1000px shell
 * while the pill draws about 366 of it, so the space beside it sits over the
 * title, the pitch copy and a table that scrolls sideways. `BottomTabBar` makes
 * the opposite call for the opposite reason — its dead band is ~28px at the
 * edge a thumb rests on, and a fall-through there spends a team.
 *
 * **The safe-area inset rides on this element, and `/app`'s answer does not
 * transfer.** The manifest is `start_url: "/app"`, `scope: "/"`, `display:
 * standalone`, and middleware bounces a signed-out visitor off `/app` to here —
 * so `/` is genuinely reachable inside the installed app, under the status bar,
 * with the root layout on `viewportFit: "cover"`. `/app` puts the inset on its
 * page WRAPPER, which works there because its header is not the pinned thing;
 * on a sticky element that would only clear the status bar at scroll 0 and ride
 * up under it afterwards. `PickStickyBar` is the precedent that transfers: the
 * inset goes on the pinned element itself. It must NOT also go on `page.tsx`'s
 * wrapper — that counts it twice, the trap `--tab-bar-h` already documents.
 *
 * One thing is still deliberately not transcribed: the design's 4px backdrop
 * blur. Only the DESKTOP signed-out frame carries it — the mobile signed-out
 * frame and both signed-in frames don't — so it reads as a leftover rather than
 * a decision. On the pill it would be dead CSS, since nothing shows through an
 * opaque white fill; on the band, which is where Figma actually puts it, it
 * would be the same containing-block bug as the filter above, because that
 * property captures `fixed` descendants by the same rule. And it would make
 * this the app's only frosted chrome, against a split CLAUDE.md records as
 * decided. Separation from the page comes from the hairline and the shadow.
 *
 * The wordmark is gone with the frames, and `APP_SHORT_NAME` went with it —
 * this was its only reader. The app names itself here through the mark's `alt`
 * instead: the mark is not a link (there is nowhere to go from `/`), so it
 * cannot carry the `aria-label` `HeaderNav` hangs on its own, and the visually
 * hidden span that used to do this job existed to sit beside a visible acronym.
 *
 * No `nav` landmark and no `aria-label` naming one: these are two buttons that
 * open dialogs, not navigation. A third "Primary" landmark would also break the
 * invariant both nav test files pin.
 */

/*
  The shared box for both ways in — the design's `size=Small` control. Not
  `Button variant="outline"` or `variant="primary"`: `outline` is 44px at 14px
  medium on the blue-tinted hairline, and `primary` carries a gradient
  background IMAGE plus a shadow that `account/spec.ts` documents at length as
  unoverridable from a className. Two plain strings are cheaper than four
  overrides and a variant name that would then be lying. Concatenated rather
  than run through `cn()`: nothing here needs merging, and this file stays a
  server component with no runtime imports.

  The frame's 100px floor only holds from 375px up: at 360 the mark, the gaps
  and the two buttons together need about 362, and that floor is what pushes it
  over. Below it they take their content width — only "Log In" actually moves,
  since "Enter Invite Code" measures past 100 on its own — which is
  `BottomTabBar`'s answer to the same problem on the same pill.

  36px drawn, 44px tapped, beyond the frame. Unlike the desktop pill this
  surface draws on phones, which is the same argument `BottomTabBar` makes for
  its own ring; the 4px each way lands inside the pill's own vertical padding so
  it can never overhang, and extending only on the y-axis keeps a button from
  stealing its neighbour's taps.
*/
const buttonBase =
  "relative inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap " +
  "rounded-control px-2 text-sm font-semibold leading-[1.2] transition-colors " +
  "min-[375px]:min-w-[100px] after:absolute after:inset-x-0 after:-inset-y-1";

/* The filled black control. Its hover step is `SPEC_BUTTON_DARK`'s, copied
   rather than imported: that constant is documented as the ACCOUNT page's
   vocabulary and is the 40px/16px skin where this is the 36px/14px one, so the
   hex is the only part they share. Same trade `InviteCta` makes spelling out a
   heading rather than importing one. */
const primaryButton = `${buttonBase} bg-shell-ink text-white hover:bg-[#333333]`;

const secondaryButton = `${buttonBase} border border-shell-line bg-white text-shell-ink hover:bg-[#F6F7F9]`;

export function LandingHeader() {
  return (
    <header className="pointer-events-none sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      {/* 8 + 58 + 8 = 74. The horizontal padding is inert at every width the
          pill fits inside — it is centred and hugs its contents — and is here
          only as the second of the two narrow-viewport escapes. */}
      <div className="flex items-center justify-center px-3 py-2 min-[375px]:px-4">
        <div className="pointer-events-auto flex shrink-0 items-center gap-3 rounded-card border border-shell-line/50 bg-white px-4 py-2 shadow-[0_6px_6px_rgba(0,0,0,0.08)]">
          {/*
            A plain <img>, not next/image — same reasoning as HeaderNav, and
            `bg-shell-line` mirrors the design's own grey behind the photo, so a
            slow asset resolves from a grey circle with no layout shift.

            `max-w-none` is prophylaxis here rather than load-bearing:
            preflight's cap resolves against the pill's content box, which is
            wider than 40px. It is the class that fixed a real 80-drawn-at-50
            bug on the picks hero, and it costs nothing to carry.

            `width`/`height` carry the aspect ratio for CLS only; the box is
            pinned in CSS, so the file behind this path can be any square.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-mark.jpg"
            alt={APP_NAME}
            width={40}
            height={40}
            className="h-10 w-10 max-w-none shrink-0 rounded-full bg-shell-line object-cover"
          />
          <LogInButton className={primaryButton} />
          <InviteCodeButton className={secondaryButton} />
        </div>
      </div>
    </header>
  );
}

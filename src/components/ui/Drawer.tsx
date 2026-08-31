"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/icons";
import { Label } from "./Label";
import { FOCUSABLE_SELECTOR, nextFocusIndex } from "./drawer";

/**
 * The rail every region inside a drawer sits on.
 *
 * Character-for-character the box `src/app/app/layout.tsx` gives `main`:
 * centred, capped at 1000, 16px gutters. The panel itself is full-bleed, so this
 * is the whole reason the drawer's columns line up with the page still visible
 * behind it. A `position: fixed` element resolves against the initial containing
 * block, which excludes the classic scrollbar — the same width `mx-auto` centres
 * the page within — so the two agree at every viewport. (That only holds because
 * `globals.css` sets `scrollbar-gutter: stable`; without it the scroll lock
 * shifts the page and not the drawer.)
 */
// `lg:px-0` mirrors the app shell's `main` exactly, and that is the whole point
// of this constant: the drawer's premise is that its content column lines up
// with the page behind it, so when `main` stopped insetting at `lg` this had to
// stop too or every desktop drawer would sit 16px narrower than the page.
export const DRAWER_RAIL = "mx-auto w-full max-w-shell px-4 lg:px-0";

/**
 * A full-width sheet that rises from the bottom edge, at every width.
 *
 * Distinct from `Modal`, which is a 480px card (a bottom sheet on phones, a
 * centred dialog from `sm`) and stays exactly as it is. This is for a surface
 * with enough controls that a 480px column was the constraint on the design
 * rather than a choice — today that is the admin settings panel, and it is the
 * only caller. Every geometric decision here is the inverse of Modal's, which is
 * why this is a second component rather than a `variant` prop: a shared one
 * would also have to decide whether the focus trap and focus restore below apply
 * to Modal's five callers, and either answer is wrong.
 *
 * Two slots beyond `children`, both inside the fixed header:
 *   - `title`/`eyebrow` — the identity, on the first line.
 *   - `subheader` — a full-rail row at the foot of the header. The tab bar.
 *
 * There was a third, `aside`, which sat beside the title from `lg` and wrapped
 * under it below; the admin drawer put its league-name field in it. That field
 * has a tab of its own now, so the slot had no content and no second caller to
 * justify it. Anything wanting a control in the header should get the slot back
 * rather than borrowing `subheader`, which is sized and spaced for the bar.
 *
 * The close button is not a slot. It is absolutely positioned in the panel's
 * top-right corner rather than laid out with the title, because it is chrome for
 * the drawer and the rail's right edge is nowhere near the corner at 1000px.
 *
 * FIXED HEIGHT, and the body is the only scroller. The panel is `h-[90dvh]` in
 * every state, so the drawer does not resize as you move between tabs — sizing
 * to content meant the header lurched, since a sheet anchored to the bottom edge
 * grows upward. The header is a `shrink-0` flex sibling and the body is
 * `min-h-0 flex-1 overflow-y-auto`; nothing inside `children` may take `max-h`
 * or `overflow`, or a short tab gains a scrollbar and a long one gains two.
 *
 * It unmounts once closed, which is deliberate and load-bearing for the caller:
 * state held OUTSIDE the drawer (the admin panel's active tab) survives close
 * and reopen, state inside it resets.
 *
 * IT SLIDES BOTH WAYS. That costs the third state the rest of this file keeps
 * having to mention — `rendered` outlives `open` for the length of the slide
 * down — and it is why the scroll lock, the focus trap and the focus restore all
 * key off `rendered`: releasing them on `open` would unlock the page and hand
 * focus back while a panel is still sitting on screen. `Modal` deliberately does
 * NOT do this and still vanishes on close; its five callers are small centred
 * cards, where an instant dismissal reads fine.
 */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  subheader,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subheader?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

  /*
   * Two booleans, because "closing" is a real state and not the absence of one.
   *
   * `open` is the caller's intent; `rendered` is whether anything is on screen.
   * They diverge for exactly one interval — the length of the slide down — and
   * everything below keys off `rendered` rather than `open` for that reason: the
   * page must stay scroll-locked and focus must stay trapped while a panel is
   * still visibly there.
   */
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      // Also covers reopening mid-close. Clearing `closing` swaps the class back
      // to `animate-drawer-up`, and a changed animation-name restarts the
      // animation on its own — there is nothing else to undo.
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
    }
  }, [open, rendered]);

  /*
   * Backstop. If `animationend` never arrives — a display:none ancestor, a
   * browser quirk, an animation cancelled out from under us — the drawer would
   * otherwise sit on screen forever with the page locked behind it, which is a
   * far worse failure than no animation at all.
   */
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [closing]);

  /*
   * `onClose` through a ref so the effect below can depend on `open` ALONE.
   *
   * Callers pass an inline arrow (`onClose={() => setSettingsOpen(false)}`), so
   * its identity changes on every render of the parent — and every section in
   * the admin drawer calls `router.refresh()` after a save, which re-renders
   * that parent. With `onClose` in the dependency array the whole effect would
   * tear down and set up again on each of those: focus restored to the trigger
   * behind the drawer, then stolen back to the panel, yanking the caret out of
   * whatever field was being typed in. Depending on `open` alone makes this run
   * exactly twice, on open and on close, which is the only thing it is for.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!rendered) return;

    // Captured before we steal focus, restored on the way out, so closing the
    // drawer puts the caret back on the gear that opened it.
    returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // `isConnected`, not a bare focus(): every section in here calls
      // router.refresh() after a save, and focusing an element React has since
      // replaced moves focus to <body> — worse than not restoring at all.
      const back = returnRef.current;
      if (back?.isConnected) back.focus();
    };
  }, [rendered]);

  // `typeof document` guards the portal during SSR. The drawer only ever renders
  // from a client interaction, so this is a type-level concern, not a real one.
  if (!rendered || typeof document === "undefined") return null;

  /*
   * The slide is over; take the drawer down.
   *
   * `e.target !== e.currentTarget` is load-bearing: animationend BUBBLES, so
   * every animated descendant — and there are several, the scrim aside — would
   * otherwise end the close early, on its own schedule.
   *
   * No special case for `prefers-reduced-motion`, though it looks like one is
   * needed. globals.css clamps every animation-duration to 0.001ms !important,
   * so this fires on the next frame and the drawer simply disappears, which is
   * what reduced motion asks for.
   */
  function onPanelAnimationEnd(e: React.AnimationEvent<HTMLDivElement>) {
    if (!closing || e.target !== e.currentTarget) return;
    setRendered(false);
    setClosing(false);
  }

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      // `offsetParent === null` is a cheap "not rendered" test, and it is only
      // valid because nothing inside this panel is position: fixed.
      (el) => el.offsetParent !== null,
    );
    const target = nextFocusIndex(
      nodes.indexOf(document.activeElement as HTMLElement),
      nodes.length,
      e.shiftKey,
    );
    // Null for the interior — see `nextFocusIndex`. Calling preventDefault on
    // every Tab would break the tab bar's roving tabindex and the rules
    // fieldset's native radio groups.
    if (target === null) return;
    e.preventDefault();
    nodes[target]?.focus();
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center",
        // A departing scrim must not swallow the click that reopens the drawer.
        closing && "pointer-events-none",
      )}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <button
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px]",
          closing ? "animate-scrim-out" : "animate-scrim-in",
        )}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        onAnimationEnd={onPanelAnimationEnd}
        className={cn(
          "relative z-10 flex w-full flex-col rounded-t-card bg-white shadow-lift outline-none",
          // `dvh`, not `vh`. On iOS Safari `vh` is the LARGE viewport — it
          // ignores the URL bar — so a panel pinned to the bottom edge puts its
          // last ~60px under the browser chrome. Modal escapes this by centring
          // from `sm`.
          //
          // `h`, not `max-h`: one height for every tab. Sizing to content made
          // the drawer jump as you moved between Members and Data Feed, and a
          // panel anchored to the bottom edge grows UPWARD, so the jump was the
          // header lurching rather than the foot settling.
          "h-[90dvh]",
          closing ? "animate-drawer-down" : "animate-drawer-up",
        )}
      >
        {/* `relative` for the close button below; `shrink-0` so the header keeps
            its height and the body absorbs the slack. No longer `sticky`: at a
            fixed height the header is structurally fixed, so there is nothing to
            pin it against and nothing scrolls under it — hence a solid
            background rather than the old translucent one. */}
        <div className="relative shrink-0 border-b border-line bg-white">
          {/* The X sits in the DRAWER's corner, not the rail's — it is chrome
              for the panel, and at 1000px the rail's right edge is nowhere near
              the corner your thumb goes to. `right-3 top-3` against the header,
              which is why that wrapper is `relative`. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink"
          >
            <XIcon className="h-5 w-5" />
          </button>

          {/* Its own rail, not one wrapper around the whole panel: the header's
              background and hairline must span the full viewport width while the
              text inside them stays on the rail. */}
          <div className={cn(DRAWER_RAIL, "py-3 lg:py-4")}>
            {/* `pr-12` here, never on DRAWER_RAIL. Padding the rail would
                inset this text 48px from the body's rail and break the alignment
                with the page behind, which is the whole premise of the drawer.
                On this block it reclaims exactly the space the X used to occupy,
                so nothing else moves.

                A plain block, not a flex row. The row existed to lay `aside` out
                beside the title and let it wrap underneath below `lg`; with the
                slot gone the title is the whole line. */}
            <div className="min-w-0 pr-12">
              {eyebrow ? <Label className="text-brand-strong">{eyebrow}</Label> : null}
              <h2
                className={cn("text-lg font-semibold leading-tight text-ink", eyebrow && "mt-0.5")}
              >
                {title}
              </h2>
            </div>

            {subheader ? <div className="mt-3">{subheader}</div> : null}
          </div>
        </div>

        {/* THE ONE SCROLLER. It moved here from the panel when the panel took a
            fixed height, and there is still exactly one: nothing inside
            `children` may take `max-h` or `overflow`, or a short tab gains a
            scrollbar and a long one gains two.

            `min-h-0` is not optional. A flex child defaults to
            `min-height: auto`, which refuses to shrink below its content — leave
            it off and the panel grows past 90dvh instead of this box
            scrolling. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children ? (
            <div className={cn(DRAWER_RAIL, "py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]")}>
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

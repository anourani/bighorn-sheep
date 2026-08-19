"use client";

import { useEffect, useRef } from "react";
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
export const DRAWER_RAIL = "mx-auto w-full max-w-shell px-4";

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
 * Three slots beyond `children`, all inside the sticky header:
 *   - `title`/`eyebrow` — the identity, on the first line with the close button.
 *   - `aside` — sits BESIDE the title from `lg` and wraps under it below. One
 *     instance, reordered, never two behind `lg:hidden`: the admin drawer puts
 *     its league-name field here, and a second copy would duplicate the input's
 *     `id` and split its React state.
 *   - `subheader` — a full-rail row at the foot of the header. The tab bar.
 *
 * THE PANEL IS THE ONLY SCROLLER. The header is `sticky`, which pins without
 * scrolling; nothing inside `children` may take `max-h` or `overflow`, or a
 * short tab gains a scrollbar and a long one gains two.
 *
 * `if (!open) return null` unmounts the subtree, which is deliberate and
 * load-bearing for the caller: state held OUTSIDE the drawer (the admin panel's
 * active tab) survives close and reopen, state inside it resets.
 *
 * No exit animation, matching every other dialog here. Playing one means keeping
 * the panel mounted past `open === false` until `animationend`, so a third
 * "closing" state exists that every caller must not reopen through — and
 * `prefers-reduced-motion` clamps animations to 0.001ms globally, so that path
 * has to work at zero duration anyway. It disappears the frame `onClose` fires.
 */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  aside,
  subheader,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  aside?: React.ReactNode;
  subheader?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

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
    if (!open) return;

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
  }, [open]);

  // `typeof document` guards the portal during SSR. The drawer only ever renders
  // from a client interaction, so this is a type-level concern, not a real one.
  if (!open || typeof document === "undefined") return null;

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
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <button
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px] animate-scrim-in"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={cn(
          "relative z-10 w-full rounded-t-card bg-white shadow-lift outline-none",
          // `dvh`, not `vh`. On iOS Safari `vh` is the LARGE viewport — it
          // ignores the URL bar — so a panel pinned to the bottom edge puts its
          // last ~60px under the browser chrome. Modal escapes this by centring
          // from `sm`. `max-h`, not `h`: the drawer is as tall as whatever tab is
          // open, since only the active panel is rendered.
          "max-h-[90dvh] overflow-y-auto overscroll-contain",
          "animate-drawer-up",
        )}
      >
        <div className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          {/* Its own rail, not one wrapper around the whole panel: the header's
              background and hairline must span the full viewport width while the
              text inside them stays on the rail. */}
          <div className={cn(DRAWER_RAIL, "py-3 lg:py-4")}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 lg:flex-nowrap lg:items-center">
              <div className="min-w-0 flex-1 lg:flex-none">
                {eyebrow ? <Label className="text-brand-strong">{eyebrow}</Label> : null}
                <h2
                  className={cn(
                    "text-lg font-semibold leading-tight text-ink",
                    eyebrow && "mt-0.5",
                  )}
                >
                  {title}
                </h2>
              </div>

              {/* DOM order is not visual order — the same `order-*` trick the
                  account page uses for Log Out / More. The close button is
                  rendered before `aside` so it keeps its place at the right edge
                  when `aside` wraps to its own line below `lg`. */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="order-2 grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink lg:order-3"
              >
                <XIcon className="h-5 w-5" />
              </button>

              {aside ? (
                <div className="order-3 w-full lg:order-2 lg:w-auto lg:min-w-0 lg:max-w-[460px] lg:flex-1">
                  {aside}
                </div>
              ) : null}
            </div>

            {subheader ? <div className="mt-3">{subheader}</div> : null}
          </div>
        </div>

        {children ? (
          <div className={cn(DRAWER_RAIL, "py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]")}>
            {children}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

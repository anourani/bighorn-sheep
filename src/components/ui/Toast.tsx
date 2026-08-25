"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { TOAST_DURATION_MS, TOAST_EXIT_BACKSTOP_MS, type ToastMessage } from "./toast";

/**
 * A single transient message, floated over the page and dismissed on a timer.
 *
 * One at a time, replaced rather than stacked. The app raises exactly one kind
 * of toast — a pick released from another week — and a stack is a scheduling
 * problem (ordering, max height, per-item timers) bought for a queue that never
 * has two things in it.
 *
 * Three things are load-bearing:
 *
 * - **It MUST portal.** Every caller so far renders inside a `.stagger` root,
 *   and `globals.css` gives each direct child of one
 *   `reveal-up 0.5s both` at an `:nth-child` delay. A toast rendered inline
 *   would inherit that on its own `fixed` root: invisible for up to 275ms while
 *   its own 320ms slide played underneath, arriving as a pop with no motion.
 *   `Drawer` portals for exactly this reason and documents it.
 * - **`role="status"`, not `role="alert"`.** Polite: the message confirms
 *   something the reader just did, so it should follow whatever the screen
 *   reader is already saying rather than interrupt it. `aria-live` is implied by
 *   the role but spelled out, because the two are set independently often
 *   enough that an explicit pair is the clearer read.
 * - **The dismissal is two-phase**, the same `rendered`-outlives-`open` shape as
 *   `Drawer`: unmounting on the timer alone would cut the exit animation off at
 *   its first frame. `prefers-reduced-motion` needs no special case —
 *   `globals.css` clamps every animation duration to 0.001ms, so `animationend`
 *   fires next frame and the toast simply appears and disappears.
 */
export function Toast({
  message,
  onDismiss,
}: {
  /** Null when there is nothing to say. A new `id` replays the entrance. */
  message: ToastMessage | null;
  onDismiss: () => void;
}) {
  const [shown, setShown] = useState<ToastMessage | null>(message);
  const [closing, setClosing] = useState(false);

  // `onDismiss` through a ref so the timer effect below can depend on the
  // message alone. Callers pass an inline arrow, so its identity changes on
  // every parent render — and MyPicksClient re-renders on every tap, which
  // would restart the dismiss timer each time and leave the toast up
  // indefinitely while someone browsed the grid.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (message) {
      // Also covers a new message arriving mid-exit: clearing `closing` swaps
      // the class back to `animate-toast-in`, and a changed animation-name
      // restarts the animation by itself.
      setShown(message);
      setClosing(false);
      return;
    }
    setClosing((wasClosing) => wasClosing || shown !== null);
  }, [message, shown]);

  // The auto-dismiss. Keyed on the message id, so a replacement gets a full
  // window rather than inheriting what was left of its predecessor's.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => dismissRef.current(), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [message]);

  // Backstop, per `TOAST_EXIT_BACKSTOP_MS`: a missed `animationend` must not
  // leave a toast parked over the page for the rest of the session.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, TOAST_EXIT_BACKSTOP_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // `document` is absent on the server pass, so the portal target has to wait
  // for mount. A toast is only ever raised by an interaction, so there is
  // nothing to render on the first paint anyway.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !shown) return null;

  return createPortal(
    /*
      Bottom-centre and `fixed`. `bottom-6` clears nothing in particular today —
      there is no fixed bottom chrome — so it is simply breathing room from the
      edge, and `pb-[env(safe-area-inset-bottom)]` keeps it off the home
      indicator on iOS.

      `pointer-events-none` on the positioner and `auto` on the card: the row
      spans the viewport so the card can centre in it, and without this it would
      swallow taps across the full width of the page for the five seconds it is
      up — on a phone, right where the pick grid is.
    */
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]"
      role="status"
      aria-live="polite"
    >
      <div
        // Keyed on the id so an identical sentence still replays its entrance —
        // releasing the same team twice running must not look like nothing
        // happened. See `raiseToast`.
        key={shown.id}
        onAnimationEnd={(e) => {
          // Guarded: `animationend` bubbles, and anything animated inside the
          // card would otherwise unmount it mid-life.
          if (e.target !== e.currentTarget || !closing) return;
          setShown(null);
          setClosing(false);
        }}
        className={cn(
          "pointer-events-auto flex max-w-[min(100%,420px)] items-center gap-3 rounded-control",
          "bg-shell-ink py-3 pl-4 pr-2 shadow-panel-sm",
          closing ? "animate-toast-out" : "animate-toast-in",
        )}
      >
        <p className="min-w-0 flex-1 text-sm leading-snug text-white">{shown.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          // `.tap-target` is a 44px min on both axes, which the card already
          // stands (py-3 over a text-sm line comes to ~44), so the floor costs
          // no extra height here — it only widens the hit area sideways.
          className="tap-target flex shrink-0 items-center justify-center rounded text-white/70 transition-colors hover:text-white"
          aria-label="Dismiss"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

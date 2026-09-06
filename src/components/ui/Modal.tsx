"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/icons";
import { Label } from "./Label";

/**
 * Lightweight accessible dialog, 480px wide. Presents as a bottom sheet on
 * phones and a centered card from `sm` — the app never routes to a separate page
 * for these.
 *
 * For a surface where 480px is the constraint rather than the choice, see
 * `Drawer` beside this: a full-width sheet that rises from the bottom at every
 * width, with a focus trap and focus restore this does not have. The admin
 * settings panel is its only caller. This component is unchanged by that and
 * should stay the default for anything that fits in a card.
 *
 * IT PORTALS TO `document.body`, and it did not until the fourth time that cost
 * somebody a day. `.stagger > *` carries `reveal-up … both`, whose `to` state is
 * `transform: translateY(0)` — fill-mode `both` leaves that transform applied for
 * the life of the page, and ANY non-`none` transform is a containing block for
 * `position: fixed` descendants. Rendered inline inside a `.stagger` child, this
 * dialog's `fixed inset-0` scrim therefore resolved against that child's box: a
 * grey rectangle over one section of the page with the panel centred inside it,
 * and nothing anywhere reporting an error.
 *
 * The workarounds are still in the tree and are worth reading as evidence of how
 * often this came up — `AccountClient` and `StandingsClient` both mount their
 * dialogs OUTSIDE `.stagger`, and `TourCarousel` (which still renders inline)
 * carries the whole argument in its own docblock. A portal makes the position of
 * the call site stop mattering, which is the only durable fix.
 *
 * A second, quieter bug goes with it: a `.stagger` child also inherits an
 * `:nth-child` entrance delay, so a dialog mounted there sat invisible for up to
 * 385ms before playing its own animation.
 *
 * The scrim animates with `scrim-in`, NOT `reveal-up`. `reveal-up` starts at
 * translateY(12px), which slid an `absolute inset-0` scrim 12px down the screen
 * for the length of the animation and left the top 12px unscrimmed and
 * unblurred. Harmless-looking behind a small card, which is why it survived
 * here for so long.
 */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // `typeof document` guards the portal on the server pass, where `open` is
  // always false in practice but nothing structurally prevents a caller passing
  // true. Same shape as `Drawer`'s.
  if (!open || typeof document === "undefined") return null;

  // A title-only header is shorter than the 36px close button, so `items-start`
  // visibly parks it above the button's centre. With an eyebrow or a description
  // the text column is the taller child and top-aligning is right: the close
  // button belongs beside the first line, not adrift in the middle of a league
  // name that has wrapped to three.
  const compact = !eyebrow && !description;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
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
        className={cn(
          "relative z-10 w-full max-w-app origin-bottom rounded-t-card bg-white shadow-lift outline-none",
          "sm:rounded-card",
          // TWO ENTRANCES, one per shape. Below `sm` this is a bottom sheet and
          // slides up like `Drawer`; from `sm` it is a centred card and takes
          // `reveal-up`'s small nudge, which is what a card should do. The pair
          // survives `cn()` because `animate-*` and `sm:animate-*` are different
          // tailwind-merge groups — the same swap `TourCarousel` makes, and its
          // note is where that was worked out.
          "animate-drawer-up sm:animate-reveal-up max-h-[92vh] overflow-y-auto",
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex justify-between gap-3 border-b border-line bg-white/95 px-card py-4 backdrop-blur",
            compact ? "items-center" : "items-start",
          )}
        >
          <div className="min-w-0">
            {eyebrow ? <Label className="text-brand-strong">{eyebrow}</Label> : null}
            {/* `mt-0.5` spaces the title from the eyebrow and means nothing
                without one — and left in, it would add 2px to this column and
                leave a centred title sitting 1px low. */}
            <h2 className={cn("text-lg font-semibold leading-tight text-ink", eyebrow && "mt-0.5")}>
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        {children ? <div className="px-card py-4">{children}</div> : null}
        {footer ? (
          <div className="sticky bottom-0 border-t border-line bg-white/95 px-card py-3 backdrop-blur">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

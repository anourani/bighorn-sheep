"use client";

import { useEffect, useRef } from "react";
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

  if (!open) return null;

  // A title-only header is shorter than the 36px close button, so `items-start`
  // visibly parks it above the button's centre. With an eyebrow or a description
  // the text column is the taller child and top-aligning is right: the close
  // button belongs beside the first line, not adrift in the middle of a league
  // name that has wrapped to three.
  const compact = !eyebrow && !description;

  return (
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
          "animate-reveal-up max-h-[92vh] overflow-y-auto",
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
    </div>
  );
}

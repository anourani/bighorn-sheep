"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/icons";
import { Label } from "./Label";

/**
 * Lightweight accessible dialog. Presents as a bottom sheet on phones and a
 * centered card on larger screens — the app never routes to a separate page for
 * these (group creation, admin settings, pick confirm all live in modals).
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
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px] animate-[reveal-up_0.2s_ease]"
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
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white/95 px-card py-4 backdrop-blur">
          <div className="min-w-0">
            {eyebrow ? <Label className="text-brand-strong">{eyebrow}</Label> : null}
            <h2 className="mt-0.5 text-lg font-semibold leading-tight text-ink">{title}</h2>
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

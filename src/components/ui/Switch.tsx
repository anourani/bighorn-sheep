"use client";

import { cn } from "@/lib/cn";

/**
 * A two-state toggle.
 *
 * A real <button role="switch"> rather than a styled checkbox: the state is
 * committed the moment it flips (there is no surrounding form to submit), and
 * `aria-checked` is what a screen reader announces on press. Callers pair it
 * with a visible word — "Paid" / "Unpaid" — because the track colour alone is
 * not a label.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name. Required — the control is icon-free and unlabelled. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "border-alive bg-alive" : "border-line bg-fill-soft",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow-panel-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

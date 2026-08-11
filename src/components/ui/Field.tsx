import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/Label";

/**
 * A read-out: an uppercase metadata label over its value. The account page and
 * the league cards are built almost entirely from these, which is why the pair
 * lives here rather than being re-hand-rolled per row.
 *
 * Not a form control despite the name — nothing here is an <input>. Editing is
 * an affordance the caller supplies: pass `onEdit` and the value becomes a
 * button, or pass `emptyLabel` and an unset value renders as an underlined link
 * ("Add") instead of blank space.
 */
export function Field({
  label,
  value,
  emptyLabel,
  onEdit,
  children,
  className,
}: {
  label: string;
  /** The value to render. Null/empty falls back to `emptyLabel`. */
  value?: string | null;
  /** Shown in link styling when `value` is empty — e.g. "Add". */
  emptyLabel?: string;
  /** Makes the value interactive. Omit for a purely informative field. */
  onEdit?: () => void;
  /** Custom value content (a select, a pill). Takes precedence over `value`. */
  children?: React.ReactNode;
  className?: string;
}) {
  const filled = Boolean(value && value.length > 0);
  const text = filled ? value : (emptyLabel ?? "—");

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label className="text-ink-mute">{label}</Label>
      {children ?? (
        onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              "self-start rounded text-left text-lg leading-[1.2]",
              filled
                ? "font-semibold text-ink hover:text-ink-soft"
                : "font-medium text-link underline underline-offset-2",
            )}
            aria-label={filled ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
          >
            {text}
          </button>
        ) : (
          <span className="truncate text-lg font-semibold leading-[1.2] text-ink">{text}</span>
        )
      )}
    </div>
  );
}

/**
 * A row of {@link Field}s under a hairline. Auto-fill rather than fixed columns
 * or breakpoints: three across on a laptop, stacked on a phone, with no media
 * query — the convention the rest of the app already follows.
 */
export function FieldRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-6 border-b border-line py-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

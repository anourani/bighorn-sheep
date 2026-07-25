import { cn } from "@/lib/cn";
import { MonoLabel } from "./MonoLabel";

type Tone = "slate" | "light" | "ghost";

const toneClasses: Record<Tone, string> = {
  // The signature: a slate data panel lit from within, floating on white.
  slate:
    "bg-surface-sheen text-onsurface border border-surface-line/60 shadow-panel [--hairline:rgba(255,255,255,0.08)]",
  light: "bg-white text-ink border border-line shadow-panel-sm",
  ghost: "bg-transparent text-ink border border-line/70",
};

export function Panel({
  tone = "slate",
  interactive = false,
  className,
  children,
}: {
  tone?: Tone;
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-card",
        toneClasses[tone],
        // Inset top hairline for the lit-panel feel on slate.
        tone === "slate" &&
          "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:rounded-t-card before:bg-[var(--hairline)]",
        interactive &&
          "transition-transform duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Optional header row for a Panel: a mono eyebrow + title, with a right slot. */
export function PanelHeader({
  eyebrow,
  title,
  right,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <MonoLabel className="text-brand-soft/90">{eyebrow}</MonoLabel> : null}
        {title ? <div className="mt-1 text-base font-medium leading-tight">{title}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

import { cn } from "@/lib/cn";

/**
 * Status pills. Every pill carries a *text* label, never color/icon alone —
 * satisfying the PRD accessibility rule for the hidden-pick and lock states.
 * Fills are opaque "washes" so a pill reads identically on a slate panel or a
 * white card.
 */
export type PillVariant =
  | "alive"
  | "out"
  | "live"
  | "final"
  | "hidden"
  | "strike"
  | "win"
  | "loss"
  | "push"
  | "pending"
  | "neutral"
  | "brand";

const variantClasses: Record<PillVariant, string> = {
  alive: "bg-alive-wash text-[#2C7A52]",
  out: "bg-out-wash text-[#A5293A]",
  live: "bg-live-wash text-[#C2551F]",
  final: "bg-[#EEF1F6] text-[#3A4356]",
  hidden: "bg-[#EEF1F6] text-[#3A4356]",
  strike: "bg-strike-wash text-[#9A6B18]",
  win: "bg-alive-wash text-[#2C7A52]",
  loss: "bg-out-wash text-[#A5293A]",
  push: "bg-[#E7EEF6] text-[#2C5788]",
  pending: "bg-[#EEF1F6] text-[#4B5563]",
  neutral: "bg-[#EEF1F6] text-ink-soft",
  brand: "bg-brand-wash text-[#B85C2B]",
};

export function Pill({
  variant = "neutral",
  icon,
  live = false,
  className,
  children,
}: {
  variant?: PillVariant;
  icon?: React.ReactNode;
  /** Show a pulsing dot (for in-progress games). */
  live?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label-sm uppercase",
        variantClasses[variant],
        className,
      )}
    >
      {live ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulse-live rounded-full bg-live" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
      ) : null}
      {icon ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span> : null}
      {children}
    </span>
  );
}

/**
 * Strike pips for two-time-elimination leagues. Filled = strike taken.
 * `tone="slate"` for use on slate panels, `"light"` on white cards.
 */
export function StrikePips({
  strikes,
  allowance,
  tone = "slate",
  className,
}: {
  strikes: number;
  allowance: number;
  tone?: "slate" | "light";
  className?: string;
}) {
  const emptyRing = tone === "slate" ? "ring-onsurface/30" : "ring-line";
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      role="img"
      aria-label={`${strikes} of ${allowance} strikes`}
    >
      {Array.from({ length: allowance }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 w-2 rounded-full",
            i < strikes ? "bg-strike shadow-[0_0_0_2px_rgba(224,164,88,0.18)]" : cn("ring-1 ring-inset", emptyRing),
          )}
        />
      ))}
    </span>
  );
}

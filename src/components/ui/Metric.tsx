import { cn } from "@/lib/cn";
import { MonoLabel } from "./MonoLabel";

/**
 * A compact metric readout: mono eyebrow + oversized mono value. The core unit
 * of the dashboard aesthetic — used for alive counts, week number, scores.
 */
export function Metric({
  label,
  value,
  sub,
  accent = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <MonoLabel className="text-onsurface-mute">{label}</MonoLabel>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "font-mono text-metric tabular-nums",
            accent ? "text-brand-strong" : "text-onsurface",
          )}
        >
          {value}
        </span>
        {sub ? <span className="font-mono text-sm text-onsurface-soft">{sub}</span> : null}
      </div>
    </div>
  );
}

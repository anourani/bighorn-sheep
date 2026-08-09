import { cn } from "@/lib/cn";
import { Label } from "./Label";

/**
 * A compact metric readout: label eyebrow + oversized value. The core unit of
 * the dashboard aesthetic — used for alive counts, week number, scores.
 * `tabular-nums` keeps digit widths fixed as values change.
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
      <Label className="text-onsurface-mute">{label}</Label>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "text-metric tabular-nums",
            accent ? "text-brand-strong" : "text-onsurface",
          )}
        >
          {value}
        </span>
        {sub ? (
          <span className="text-sm font-semibold tabular-nums text-onsurface-soft">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

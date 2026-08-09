import { cn } from "@/lib/cn";

/**
 * A flat section heading on the white page — a title over a hairline, with an
 * optional right slot for a control (the standings gear lives there).
 *
 * Deliberately not a `Panel`: these sections carry no surface of their own, so
 * the rule under the title is the only thing separating them.
 *
 * The design spec carries `font-variant: small-caps`, which is not applied here:
 * Figma exports the property whether or not the rendered text uses it, and the
 * mockup plainly shows a descending "g" in both "League" and "Standings" — i.e.
 * ordinary title case. Synthesising small caps from it renders "LEAGUE".
 */
export function SectionHeader({
  title,
  right,
  className,
}: {
  title: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line pb-1.5 pt-3", className)}>
      <h2 className="flex-1 text-xl font-bold leading-[1.4] text-black">{title}</h2>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

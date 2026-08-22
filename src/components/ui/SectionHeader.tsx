import { cn } from "@/lib/cn";

/**
 * A flat section heading on the white page — a title, with an optional right
 * slot for a control.
 *
 * Deliberately not a `Panel`: these sections carry no surface of their own.
 *
 * It carries no padding and no rule. It used to have both — `pt-3 pb-1.5` under
 * a `border-b` hairline — and the redesign drops the hairline everywhere, which
 * leaves the padding with nothing to space away from. Vertical rhythm is the
 * call site's now: every caller sets its own gap to the content beneath (12px
 * today, `mt-3`) and to the block above.
 *
 * The design spec carries `font-variant: small-caps`, which is not applied here:
 * Figma exports the property whether or not the rendered text uses it, and the
 * mockup plainly shows a descending "g" in both "League" and "Standings" — i.e.
 * ordinary title case. Synthesising small caps from it renders "LEAGUE".
 *
 * Titles are Title Case, small words lowercase — "Practice Standings", and the
 * "Grow the League" the invite module now draws for itself, where the last word
 * is capitalised even when it is a preposition.
 *
 * Down to one caller: the practice empty-state on Standings. The invite module
 * and the account page both want a heading with something sitting immediately
 * beside it, which the `flex-1` on the `h2` below cannot do — it exists to push
 * the `right` slot to the far edge of the row.
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
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2", className)}>
      <h2 className="flex-1 text-xl font-semibold leading-[1.2] text-black">{title}</h2>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

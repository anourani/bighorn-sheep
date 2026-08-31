import { cn } from "@/lib/cn";
import { HeadcountGrid } from "@/components/app/HeadcountGrid";
import { headcountLine, type HeadcountInput } from "@/lib/league/view";

/**
 * "W6 Headcount · 29 still standing · 54%" over the grid of member cubes, on a
 * soft-grey card. Figma `4158:148496` (desktop) and `4181:155234` (mobile).
 *
 * Shared by the landing page and the signed-in standings page — same data, same
 * `headcountLine()` strings, one column: a label line, then the grid. It lives
 * in `app/` rather than `landing/` for the reason `HeadcountGrid` does: the
 * landing page is the borrower here, and a signed-out page must not reach into a
 * folder that may import server-only league loading.
 *
 * A Server Component, deliberately. Only the grid below needs `"use client"`,
 * and drawing this row here is what keeps `lib/league/view.ts` out of the
 * landing page's client bundle.
 *
 * **The section root IS the card**, and that changed the deal with its hosts.
 * It used to be a transparent block whose grid broke out of the page's inset
 * with `-mx-4`; it is now a filled, rounded box that fills the content column
 * exactly, so there is no bleed left anywhere in it and a host must NOT pass
 * horizontal padding — `px-*` in `className` would land inside the fill and
 * inset the card's own contents. A host that needs the card inset from
 * something wraps it. Vertical spacing is still the host's, as everywhere else.
 */
export function Headcount({
  headcount,
  className,
}: {
  headcount: HeadcountInput;
  className?: string;
}) {
  const { lead, leadShort, primary, percent, percentLabel } = headcountLine(headcount);

  return (
    // 12px all round on a phone; 16 at the sides and underneath from `lg`, where
    // the top stays 12. Asymmetric as drawn, not as a slip: the label's line box
    // sits lower in its own row than the grid's last row does above the foot.
    <section
      className={cn(
        "flex flex-col gap-2 rounded-control bg-fill-soft p-3 lg:gap-1 lg:px-4 lg:pb-4",
        className,
      )}
    >
      {/* One row, two justifications: the mobile frame throws the label and the
          tally to opposite edges, the desktop frame sits them 12px apart on the
          left. `flex-wrap` stays as an escape valve only. */}
      <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-start">
        {/* `em`, not the frame's `-0.28px`. Figma reports letter-spacing as
            percent times 100, so this step's -2 IS -2% and `em` is that
            percentage directly, where px is a conversion to redo if the size
            ever moves. */}
        <span className="text-sm font-semibold leading-[1.2] tracking-[-0.02em] text-shell-ink">
          {/* The design draws the abbreviation at BOTH widths — the desktop
              frame carries "W6 Headcount" too — so this is not a breakpoint
              swap. It is still a pair, because "W6" names nothing out loud: the
              drawn form is `aria-hidden` and the long one is `sr-only` at every
              width, so the page shows "W6 Headcount" and a screen reader hears
              "Week 6 Headcount". Reversing that — `hidden` on the long form —
              would drop it from the tree entirely. `sr-only` is absolutely
              positioned, so it takes no width and the space before "Headcount"
              is the one that renders. */}
          <span aria-hidden>{leadShort}</span>
          <span className="sr-only">{lead}</span> Headcount
        </span>
        {/* 1.35 rather than the heading's 1.2: this is the taller of the two
            line boxes, so it alone sets the label row's height. */}
        <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.35] tracking-[-0.01em]">
          <span className="text-shell-ink">{primary}</span>
          {percent ? (
            // Accent, where the muted half used to be — and the same pairing as
            // the heading one line up, for the same reason: a bare "54%" beside
            // "29 still standing" names neither of them.
            <span className="text-accent">
              <span aria-hidden>{percent}</span>
              <span className="sr-only">{percentLabel}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* The mobile frame insets its grid 2px inside the card's own padding and
          the desktop frame does not. It sits on this wrapper rather than on the
          grid so the grid's measured content box stays the box the solver is
          laying out into — padding on the grid itself would make it measure 4px
          more than it gets. */}
      <div className="px-0.5 lg:px-0">
        <HeadcountGrid headcount={headcount} />
      </div>
    </section>
  );
}

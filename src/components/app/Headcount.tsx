import { cn } from "@/lib/cn";
import { HeadcountGrid } from "@/components/app/HeadcountGrid";
import { headcountLine, type HeadcountInput } from "@/lib/league/view";

/**
 * "W6 Headcount · 29 still standing · 54%" over the grid of member cubes.
 * Figma `3720:40767` (desktop) and `4118:147326` (mobile).
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
 * Carries no *vertical* padding of its own because its two hosts space it
 * differently (the landing page's own rhythm vs. the app shell's `main`) — each
 * passes its own via `className`.
 *
 * Horizontally it is the other way round, and this is the one thing a third host
 * would trip over: below `lg` the grid runs edge to edge while the label stays
 * inset, and it gets there by cancelling the host's inset with `-mx-4`. That
 * assumes every host supplies exactly 16px of it. Both do today — the landing
 * page passes `px-4`, and the app shell's `main` has it (src/app/app/layout.tsx).
 * A host with any other inset will bleed by the wrong amount.
 *
 * "Headcount" is composed here rather than folded into `headcountLine()`,
 * because it's this section's own chrome: the same strings appear without it
 * wherever a bare "Week 6" is what's wanted.
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
    <section className={cn("flex flex-col gap-1", className)}>
      {/* One row, two justifications: the mobile frame throws the label and the
          tally to opposite edges, the desktop frame sits them 16px apart on the
          left. `flex-wrap` stays as an escape valve only — this row is inside
          the host's inset, so an overflow here would push the document. */}
      <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-start">
        {/* `em`, not the frame's `-0.28px`. Figma reports letter-spacing as
            percent times 100, so this step's -2 IS -2% and `em` is that
            percentage directly, where px is a conversion to redo if the size
            ever moves. */}
        <span className="text-sm font-semibold leading-[1.2] tracking-[-0.02em] text-shell-ink">
          {/* The design draws the abbreviation at BOTH widths now — the desktop
              frame carries "W6 Headcount" too — so this is no longer a
              breakpoint swap. It is still a pair, because "W6" names nothing out
              loud: the drawn form is `aria-hidden` and the long one is `sr-only`
              at every width, so the page shows "W6 Headcount" and a screen
              reader hears "Week 6 Headcount". Reversing that — `hidden` on the
              long form — would drop it from the tree entirely. `sr-only` is
              absolutely positioned, so it takes no width and the space before
              "Headcount" is the one that renders. */}
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

      {/* Below `lg` the grid spans the full viewport by cancelling the host's
          16px inset, while the label above it stays put — which is the whole
          point of the mobile variant. `-mx-4` inside a `px-4` parent resolves to
          exactly that parent's border box, so this cannot overflow; the `px-0.5`
          on top of it is the mobile frame's own 2px inset, and it sits on this
          wrapper rather than on the grid so the grid's measured content box is
          the width the solver is actually laying out into. */}
      <div className="-mx-4 px-0.5 lg:mx-0 lg:px-0">
        <HeadcountGrid headcount={headcount} />
      </div>
    </section>
  );
}

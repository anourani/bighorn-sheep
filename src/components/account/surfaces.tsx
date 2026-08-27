import { cn } from "@/lib/cn";
import { H3 } from "@/lib/type-scale";

/**
 * The account page's shared surface vocabulary.
 *
 * Three block-level components on this page (Personal Details, League Dues,
 * Additional Settings) draw the same title-over-cards shape at the same sizes,
 * and the mock-ups are exact about all of it. Spelling the numbers once here is
 * what stops one block drifting a pixel off the one above it — the failure mode
 * is invisible in isolation and obvious when they are stacked.
 */

/**
 * The grey card: `#F3F3F3`, 8px radius, 16px sides, 20px top and bottom.
 *
 * **One radius for the whole page**, `radius/small`, cards and Additional
 * Settings rows alike. This entry used to argue the opposite at length — 4px
 * cards against 8px rows, "in the design at both widths, so the two are not a
 * mistake waiting to be unified" — and that was true of the old mock-ups. The
 * restack's Figma then gave League Dues 8px while leaving Personal Details at 4,
 * i.e. it disagreed with itself, and carrying two card radii to reproduce a slip
 * is not worth the constant it would take. Unified deliberately, with the number
 * chosen rather than inherited; don't re-split it on the strength of one frame.
 */
export const CARD = "rounded-control bg-fill-soft px-4 py-5";

/**
 * A card row's value, and the section-heading and body sizes beside it.
 *
 * Figma reports letter-spacing as percent × 100, so H5's `-4` is −4%, or −0.8px
 * at 20px. Transcribing those numbers as pixels directly is how a headline ends
 * up four times too tight.
 *
 * `PAGE_TITLE` is H3, which is why it is composed from `lib/type-scale.ts`
 * rather than spelled here: H3 moved from 28px at −2% to 32px at −4%, and it is
 * shared with the pick filters and the login invite preview. Its tracking is
 * written `-0.04em` there — the percentage itself, with no conversion to redo
 * when the size next moves.
 */
export const VALUE = "text-[18px] font-semibold leading-[1.2] tracking-[-0.18px] text-shell-ink";
export const HEADING = "text-[20px] font-semibold leading-[1.2] tracking-[-0.8px] text-shell-ink";
export const PAGE_TITLE = `${H3} text-shell-ink`;

/** Body copy inside a card — 16px, the secondary grey unless told otherwise. */
export const BODY = "text-[16px] leading-[1.35] tracking-[-0.16px]";

/**
 * A titled block: the 20px heading over its cards, 12px apart.
 *
 * `h2` rather than the shared `SectionHeader`: that component's hairline *is*
 * the separation between its surface-less sections and is what its callers on
 * Standings want. Here the grey cards do the separating, so the rule would draw
 * a second divider 12px above the first.
 */
export function AccountSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className={HEADING}>{title}</h2>
      {children}
    </section>
  );
}

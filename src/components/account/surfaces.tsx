import { cn } from "@/lib/cn";

/**
 * The account page's shared surface vocabulary.
 *
 * Three column-level components on this page (Personal Details, For the Common
 * Good, More) draw the same title-over-cards shape at the same sizes, and the
 * mock-ups are exact about all of it. Spelling the numbers once here is what
 * stops the second column drifting a pixel off the first — the failure mode is
 * invisible in isolation and obvious side by side.
 */

/**
 * The grey card: `#F3F3F3`, 4px radius, 16px sides, 20px top and bottom.
 *
 * **4px, not `rounded-control` (8px)** — and the "More" rows below genuinely are
 * 8px. That difference is in the design at both widths, so the two are not a
 * mistake waiting to be unified.
 */
export const CARD = "rounded-[4px] bg-fill-soft px-4 py-5";

/**
 * A card row's value, and the section-heading and body sizes beside it.
 *
 * Figma reports letter-spacing as percent × 100, so H3's `-2` is −2% — −0.56px
 * at 28px — and H5's `-4` is −4%, or −0.8px at 20px. Transcribing those numbers
 * as pixels directly is how a headline ends up four times too tight.
 */
export const VALUE = "text-[18px] font-semibold leading-[1.2] tracking-[-0.18px] text-shell-ink";
export const HEADING = "text-[20px] font-semibold leading-[1.2] tracking-[-0.8px] text-shell-ink";
export const PAGE_TITLE =
  "text-[28px] font-semibold leading-[1.2] tracking-[-0.56px] text-shell-ink";

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

import { cn } from "@/lib/cn";

/**
 * Uppercase semibold metadata label — 12px. Every grey label in the app is this
 * component, bar the "Change week" eyebrow in `WeekPicker`, which has to be a
 * real <label htmlFor> and so repeats these classes by hand.
 *
 * The size is spelled `text-xs`, NOT the `label-md` token from
 * `tailwind.config.ts` that happens to specify the same 0.75rem, and that is
 * load-bearing. `cn()` runs tailwind-merge, which decides what a class conflicts
 * with by parsing its name: `text-xs` is a known font size, but `label-md` is
 * not a t-shirt size, so `text-label-md` is filed as a text COLOUR and deleted
 * outright the moment a caller passes one. Every call site here passes a colour,
 * so the token never once reached the DOM and every label in the app inherited
 * 16px from the page.
 *
 * The same trap applies to `text-label-sm`, `text-metric` and `text-display-*`.
 * Keep custom fontSize tokens out of any `cn()` call that also takes a colour.
 */
export function Label({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-xs font-semibold uppercase leading-none text-[#757575]", className)}>
      {children}
    </span>
  );
}

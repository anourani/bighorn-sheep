import { cn } from "@/lib/cn";

/**
 * Uppercase semibold metadata label — 12px. Every grey label in the app is this
 * component.
 *
 * Pass `htmlFor` and it renders a real `<label>` instead of a `<span>`. That is
 * not cosmetic: where the label names a form control, the control's accessible
 * name becomes the exact string on screen and cannot drift from it (as an
 * `aria-label` silently can), and clicking the label focuses the control.
 * `w-fit` then stops a block-level label from claiming the rest of the line as
 * an invisible hit area. `WeekPicker` and the header's league switcher both use
 * this form; before it existed they copied these classes by hand.
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
  htmlFor,
}: {
  children: React.ReactNode;
  className?: string;
  /** Id of the control this labels. Switches the element to a real `<label>`. */
  htmlFor?: string;
}) {
  const classes = cn(
    "text-xs font-semibold uppercase leading-none text-shell-mute",
    htmlFor && "block w-fit cursor-pointer",
    className,
  );

  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={classes}>
        {children}
      </label>
    );
  }
  return <span className={classes}>{children}</span>;
}

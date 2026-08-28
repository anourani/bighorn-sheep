import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "soft" | "outline" | "ghost" | "dark" | "subtle" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium select-none transition-[transform,background-color,box-shadow,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&>svg]:h-4 [&>svg]:w-4";

const variants: Record<Variant, string> = {
  primary: "bg-brand-sheen text-white shadow-panel-sm hover:brightness-[1.05] hover:shadow-glow",
  secondary: "bg-surface text-onsurface border border-surface-line hover:bg-surface-muted",
  // Neutral filled — a tile rather than a call to action. Sits beside `outline`
  // where two adjacent controls need to read as equal weight.
  soft: "bg-fill-soft text-ink border border-line hover:bg-fill-deep",
  outline: "bg-white text-ink border border-line hover:bg-[#F6F7F9]",
  ghost: "bg-transparent text-ink hover:bg-[#F1F2F5]",
  // The design's filled black control. A real variant rather than a className
  // override on `primary`, because `primary` cannot be repainted from a call
  // site: `bg-brand-sheen` is a background *image*, so a background *colour*
  // lands in a different tailwind-merge group and the gradient survives on top,
  // and `shadow-none` loses to `shadow-panel-sm` outright (tailwind-merge does
  // not parse `panel-sm` as a shadow size, so it never treats the two as
  // alternatives). `src/components/account/spec.ts` documents that trap at
  // length and works around it with `variant="ghost"` plus SPEC_BUTTON_DARK;
  // this variant is the same black, reached without the workaround. The
  // `font-semibold` beats base's `font-medium` on source order within one group.
  dark: "bg-shell-ink text-white font-semibold hover:bg-[#333333]",
  // For placement on slate panels.
  subtle: "bg-white/10 text-onsurface border border-white/15 hover:bg-white/[0.16] focus-visible:ring-offset-surface",
  danger: "bg-out text-white hover:brightness-105",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-control",
  md: "h-11 px-4 text-sm rounded-control",
  lg: "h-12 px-5 text-base rounded-control",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  pill = false,
  block = false,
}: { variant?: Variant; size?: Size; pill?: boolean; block?: boolean } = {}): string {
  return cn(base, variants[variant], sizes[size], pill && "rounded-pill", block && "w-full");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  pill?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, pill, block, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, pill, block }), className)}
      {...props}
    />
  );
});

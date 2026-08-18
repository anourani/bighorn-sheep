/**
 * The account page's two button skins, in one place because five call sites
 * across four files want them and a sixth would otherwise invent a seventh
 * shade of black.
 *
 * Both are overrides on the existing `Button` primitive rather than new
 * variants or a new size axis. 40px sits between `sm` (36) and `md` (44) and
 * exists on exactly two controls here; adding a size to a primitive every screen
 * uses would be the more expensive answer for a page-local spec. Each class
 * below lands in the same tailwind-merge group as the one it replaces, and
 * `className` is applied last in `Button`, so every one of them takes effect.
 */

/**
 * The design's white-on-white control: 40px tall, 16px semibold, a `#D9D9D9`
 * hairline. Used on "Copy Link". Pair with `variant="outline" size="sm"`.
 */
export const SPEC_BUTTON_LIGHT =
  "h-10 border-shell-line px-3 text-base font-semibold text-shell-ink";

/**
 * The filled black control: `#1E1E1E`, white 16px semibold. Used on "Edit" (40px,
 * `size="sm"`) and "Log Out" (48px, `size="lg"`). Pair with **`variant="ghost"`**.
 *
 * **Not `variant="primary"`, and that is the whole point of this constant.**
 * `primary` carries `bg-brand-sheen` (a background *image* gradient) and
 * `shadow-panel-sm`, and neither can be overridden from here:
 *
 * - `bg-shell-ink` sets a background *colour*, which tailwind-merge files in a
 *   different group from a background image — so the gradient survives and keeps
 *   painting on top. `bg-none` clears it, but only after you know to look.
 * - `shadow-none` loses outright. tailwind-merge decides what a class conflicts
 *   with by parsing its name, and `panel-sm` is not a shadow size it recognises,
 *   so it never treats the two as alternatives and leaves both in the list. CSS
 *   source order then decides, and Tailwind emits `extend`ed utilities after the
 *   defaults — so `shadow-panel-sm` wins and the design's flat button ships with
 *   a soft drop shadow under it. This was measured, not reasoned about; it is the
 *   same trap `Label`'s docblock describes for `text-label-md`.
 *
 * `ghost` carries neither. Its three declarations — `bg-transparent`, `text-ink`,
 * `hover:bg-[#F1F2F5]` — are all plain, recognised utilities that the overrides
 * below genuinely replace.
 */
export const SPEC_BUTTON_DARK =
  "bg-shell-ink px-3 text-base font-semibold text-white hover:bg-[#333333]";

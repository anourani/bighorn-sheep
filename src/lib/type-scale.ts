/**
 * Shared type-scale constants — the design library's steps, spelled once.
 *
 * A class STRING rather than a `fontSize` token in `tailwind.config.ts`, and
 * that is load-bearing rather than a preference. `cn()` runs tailwind-merge,
 * which decides what a class conflicts with by parsing its name: a t-shirt size
 * like `text-xs` is a font size, but `h3` is not, so a `text-h3` token would be
 * filed as a text COLOUR and deleted outright the moment a caller passes one —
 * which every call site here does. `ui/Label.tsx` documents that trap in full,
 * from the time it cost the app every 12px label in it; the four `display-*` and
 * `label-*` tokens still in the config are dead for the same reason.
 *
 * It lives in `src/lib/` rather than in `components/account/surfaces.tsx`, which
 * already holds constants of exactly this shape, because that file is documented
 * as the ACCOUNT page's vocabulary and `InviteCta` spells its `HEADING` out by
 * hand rather than reach across for it — "a `group/ -> account/` import would
 * quietly promote it into something shared without saying so". This module is
 * that promotion, said out loud. A leaf with no imports, like `accent.ts`.
 */

/**
 * H3 — 32px over 120%, semibold, -4%.
 *
 * One size at every width: the pick filters used to step 20px -> 28px at `lg`
 * and now take this at both, which is what the mock-up draws on a phone.
 *
 * **No colour**, unlike `surfaces.tsx`'s `PAGE_TITLE`. `PickFilters` paints the
 * same type in three different greys depending on state, so a baked-in
 * `text-shell-ink` would make the constant unusable exactly where it is most
 * needed. Callers compose — `cn(H3, "text-shell-faint")` merges correctly,
 * because `text-[32px]` is an arbitrary length and tailwind-merge reads it as
 * the font size it is.
 *
 * **`-0.04em`, not `-1.28px`.** Figma reports letter-spacing as percent times
 * 100, so this step's `-4` is -4%; `em` IS that percentage, where a pixel value
 * is a conversion that has to be redone every time the size moves.
 * `surfaces.tsx` carries a whole paragraph about getting that arithmetic wrong.
 */
export const H3 = "text-[32px] font-semibold leading-[1.2] tracking-[-0.04em]";

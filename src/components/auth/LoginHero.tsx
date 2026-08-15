import { BrandMark } from "@/components/shell/BrandMark";
import { Label } from "@/components/ui/Label";

/**
 * The two heroes that sit above the sign-in card on `/login`.
 *
 * They live here, and `LoginFlow` picks between them, because which one is
 * correct depends on the step — and the step is state inside `LoginFlow`. The
 * page can't know it without becoming a client component, and duplicating the
 * markup on both sides is exactly how the two surfaces drift.
 *
 * Neither renders in the landing modal (`variant="modal"`): that overlay opens
 * on top of the marketing page, which already carries the branding.
 */

/**
 * The full hero — badge, eyebrow, wordmark, one-line explainer.
 *
 * This is the cold-open header: an invite link pasted into a group chat, or an
 * `/auth/callback` bounce, lands here with no page behind it, so the first
 * screen has to say what the app *is* before it asks for an email.
 */
export function LoginHero() {
  return (
    <div className="mb-8 text-center">
      <div className="mb-5 flex justify-center">
        <BrandMark size="lg" />
      </div>
      <Label className="text-brand-strong">NFL Survival League</Label>
      <h1 className="mt-2 text-display-md font-medium leading-[1.02] tracking-tight text-ink">
        Last Man
        <br />
        Standing
      </h1>
      <p className="mx-auto mt-3 max-w-[32ch] text-sm leading-relaxed text-ink-soft">
        One team a week. Lose once and you&apos;re out. The last survivor takes the season.
      </p>
    </div>
  );
}

/**
 * The pared-back hero for the interim steps — the eyebrow and a single large
 * headline, nothing else.
 *
 * By the time someone reaches "check your inbox" or "tell us your name" they've
 * already read the pitch and committed, so the badge and the explainer are
 * spent: they push the only thing left to do below the fold on a phone. The
 * headline takes over as the page's statement of where you are.
 *
 * Type is transcribed from the mock-up rather than the `display-*` tokens,
 * which are a size lighter (weight 500) and tighter-leaded than this: 48px on
 * phones stepping to 64px from `md`, semibold, `-2px` tracking flat at both
 * sizes (the mock-up specifies the same absolute value for each). The `clamp`
 * holds 48px across real phone widths and only gives ground below ~375px,
 * where a fixed 48px would start forcing awkward breaks.
 */
export function LoginStepHero({ headline }: { headline: string }) {
  return (
    <div className="mb-8 flex flex-col items-center gap-2 text-center">
      {/* No colour override: `Label`'s own `text-shell-mute` is the #757575 the
          mock-up asks for. `text-base` is a real Tailwind size, so it displaces
          the component's `text-xs` through tailwind-merge instead of being
          dropped the way a `text-label-*` token would be. */}
      <Label className="text-base leading-[1.1]">NFL Survival League</Label>
      <h1 className="text-[clamp(2.25rem,12vw,3rem)] font-semibold leading-[1.2] tracking-[-2px] text-ink md:text-[4rem]">
        {headline}
      </h1>
    </div>
  );
}

import { Label } from "@/components/ui/Label";

/**
 * The hero above the sign-in card on `/login`.
 *
 * **One hero, every step, every arrival — that is the entire point of it.**
 * There used to be two, picked by `LoginFlow`'s `step`: a full badge-and-pitch
 * hero for the cold open and a headline-only one for "check your inbox" and
 * "tell us your name". The reasoning was sound in isolation (by the interim
 * steps you have read the pitch, so the badge only pushes the remaining action
 * below the fold) and wrong in aggregate: following one invite link walked you
 * through two different headers, and the second one contradicted the card under
 * it — a returning player got "You're Invited to the League" stacked on top of
 * "Welcome back", because the headline keyed off `invite` while the card keyed
 * off whether the address already had an account. Nothing reconciled them.
 *
 * So the header no longer moves. `eyebrow` is the only thing that varies, and it
 * varies on the ONE fact that is fixed for the whole visit — whether the URL
 * carried an invite code — never on `step`, which changes underneath the reader.
 * The card below is where progress is reported; the hero says where you are.
 *
 * Neither `variant="modal"` caller renders this: that overlay opens on top of
 * the marketing page, which already carries the branding.
 */
export function LoginHero({ eyebrow }: { eyebrow: string }) {
  return (
    /* `px-4` is the design's own, and it is on this block rather than on the
       page: `/login`'s `main` deliberately has no gutter so this hero can use
       the full 600px column while the card below it stays in its 480px one. See
       login/page.tsx. */
    <div className="mb-8 flex flex-col items-center gap-2 px-4 text-center">
      {/* 16px semibold uppercase #757575. `Label` is already uppercase, semibold
          and `text-shell-mute` (#757575 exactly), so only the size and leading
          are overridden — and `text-base` is a real Tailwind size, so it
          displaces the component's `text-xs` through tailwind-merge instead of
          being dropped the way a `text-label-*` token would be. */}
      <Label className="text-base leading-[1.1]">{eyebrow}</Label>
      {/*
        64px semibold, leading-none, pure black — the design's H1, and the same
        wordmark the landing page leads with, so the two doors match.

        Tracking is `-0.05em`, NOT the flat `-3.2px` the design states. That is a
        deliberate departure and the opposite call from the landing page's flat
        `-2px`: there the mock-up specifies the same absolute value at BOTH 64px
        and 88px, so it demonstrably does not scale. Here there is one size on
        one artboard, and -3.2px at 64px IS -0.05em — so binding it to the em is
        the only reading that survives the clamp below. A flat -3.2px would eat
        9% of the glyph width at the 36px floor and collapse the word.

        The clamp exists because 64px "Last Man Standing" measures 523px and a
        phone has ~360px to give. 9vw reaches 64px at a 711px viewport, where the
        column is already 568px wide; the 2.25rem floor keeps one line down to
        ~330px and simply wraps below that rather than overflowing, which is why
        the design's `whitespace-nowrap` is deliberately NOT transcribed.
      */}
      <h1 className="text-[clamp(2.25rem,9vw,4rem)] font-semibold leading-none tracking-[-0.05em] text-black">
        Last Man Standing
      </h1>
      {/* 18px/1.4 at 382px, inside the design's own 16px padding — so `p-4` plus
          a 414px cap, not a 382px one. The copy is the landing page's, extended
          by the no-repeats rule and with the closing sentence lifted onto its own
          line: same three-tone treatment (ink / mute / ink), same voice, so the
          invite screen and the marketing page read as one product. */}
      <div className="max-w-[414px] p-4 text-lg/[1.4] tracking-[-0.01em]">
        <p className="text-shell-ink">A private NFL survivor league with friends.</p>
        <p className="text-shell-mute">
          Pick one team a week. Win to advance to the next week. Lose or tie and
          you&apos;re out. You can&apos;t pick the same team twice.
        </p>
        <p className="text-shell-ink">The last man standing wins.</p>
      </div>
    </div>
  );
}

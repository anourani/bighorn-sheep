import { Label } from "@/components/ui/Label";
import { LeaguePitch } from "@/components/landing/LeaguePitch";

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
       login/page.tsx.

       `mb-5`, not `mb-8`: the description carries its own 16px of bottom padding
       and the design puts 36px between the last line of copy and the league card
       — 16 from the description, 20 from the title block. */
    <div className="mb-5 flex flex-col items-center gap-2 px-4 text-center">
      {/* 16px semibold uppercase #757575. `Label` is already uppercase, semibold
          and `text-shell-mute` (#757575 exactly), so only the size and leading
          are overridden — and `text-base` is a real Tailwind size, so it
          displaces the component's `text-xs` through tailwind-merge instead of
          being dropped the way a `text-label-*` token would be. */}
      <Label className="text-base leading-[1.1]">{eyebrow}</Label>
      {/*
        Semibold, leading-none, pure black — the design's H1, and the same
        wordmark the landing page leads with, so the two doors match.

        TWO anchors, one on each artboard: 36px at -1.44px on the phone, 64px at
        -3.2px on the desktop. The size ramp hits both exactly — `9vw` is 36px at
        400px and reaches the 4rem cap at a 711px viewport — and the 2.25rem
        floor is the phone value itself, so nothing is interpolated at the ends.
        The design's `whitespace-nowrap` is deliberately not transcribed: below
        ~330px the word wraps rather than pushing the page sideways.

        The tracking needs its own ramp, because the two anchors DISAGREE about
        the em: -1.44/36 is -0.04em and -3.2/64 is -0.05em, so no single em value
        and no single px value hits both. Fitting a line through them gives
        `0.823px - 0.566vw`, which lands on -1.44px at 393px and -3.2px at 711px
        and is bounded by the anchors themselves either side. This is the same
        job the landing page does with a flat `-2px` and the opposite answer,
        for the honest reason that ITS two anchors agree and these two don't.
      */}
      <h1 className="text-[clamp(2.25rem,9vw,4rem)] font-semibold leading-none tracking-[clamp(-3.2px,0.823px_-_0.566vw,-1.44px)] text-black">
        Last Man Standing
      </h1>
      {/* 16px/1.35 full-bleed on the phone, stepping to 18px/1.4 inside a 382px
          measure on the desktop — the cap is 414px because the design's 382px is
          the TEXT and its 16px padding sits outside it. Only the horizontal
          padding is held back below `md`, where the phone frame runs the copy to
          the section's own gutter and pads vertically alone.

          Tracking is flat `-0.01em`, unlike the headline above: -0.16/16 and
          -0.18/18 are the same em, so here the two artboards agree and one value
          serves both.

          `md`, not `lg`: this route is outside /app and inherits none of its
          `lg` turn-over rule, and 768px is where the headline has already
          reached its 64px cap (711px) — so the two halves of the hero step up
          together rather than 250px apart.

          The copy is the landing page's, and now literally so — `LeaguePitch`
          is the one component both doors render, so the invite screen and the
          marketing page cannot say different things about the same game. It
          brings no geometry with it; everything above is this wrapper's. */}
      <div className="w-full py-4 text-base/[1.35] tracking-[-0.01em] md:max-w-[414px] md:px-4 md:text-lg/[1.4]">
        <LeaguePitch />
      </div>
    </div>
  );
}

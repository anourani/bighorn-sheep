/**
 * The arithmetic behind the fade+blur reveal, kept out of the component so it
 * unit-tests without a component-test stack — the same split `pick-hero.ts`,
 * `card-reveal.ts` and `week-strip.ts` make, and the repo's standing convention
 * (vitest runs in the Node environment; there is no jsdom here).
 *
 * The reveal itself is one CSS keyframe, `blur-in` in `tailwind.config.ts`:
 * opacity 0 -> 1, blur(12px) -> blur(0), scale(1.04) -> scale(1) over 1250ms.
 * Everything variable about it is the DELAY, and that is what lives here.
 *
 * Two surfaces use it: the landing title (five words, one cascade, never
 * replayed) and the My Picks hero (~29 pieces — three colour strips, a logo,
 * and every line of text — replayed whole on a team tap or a week change).
 */

/**
 * The step between one revealed piece and the next. The whole feel of the
 * cascade is this number against the 1250ms duration below: at 40ms a piece
 * starts while its predecessor is 3% through, so the module resolves as one
 * wave rather than as a queue of separate animations.
 *
 * It is also the only lever on the cascade's total length — see the note on
 * `cascadeStarts`.
 */
export const BLUR_STEP_MS = 40;

/**
 * Mirrors the duration in `tailwind.config.ts`'s `blur-in` token. Nothing reads
 * it at runtime — the animation is entirely CSS — but the relationship between
 * the two constants is what makes the effect a wave, so it is asserted in the
 * tests beside this file rather than left as a comment that can go stale.
 */
export const BLUR_DURATION_MS = 1250;

/**
 * The two class tokens every revealed element carries.
 *
 * `animate-blur-in` is the Tailwind utility, and it must appear as a literal
 * somewhere under `src/` or the `@keyframes blur-in` rule is never emitted at
 * all — `content` is scanned for class names, and a keyframe with no utility
 * referencing it is dropped. That is the same coupling that already binds
 * `globals.css`'s `.stagger` rule to `Modal.tsx`'s `animate-reveal-up`.
 *
 * `reveal-blur` carries no declarations of its own. Its only job is to be the
 * target of the `prefers-reduced-motion` override in `globals.css`, which has
 * to turn the animation off outright: the global reduce block zeroes animation
 * DURATIONS and not delays, and `fill-mode: both` holds the invisible, blurred
 * first frame right through the delay — so without it a reduced-motion visitor
 * watches the hero sit blank for over a second, staggered.
 */
export const BLUR_REVEAL_CLASS = "reveal-blur animate-blur-in";

/**
 * Split a line into the words that animate separately.
 *
 * Collapses runs of whitespace rather than splitting on a single space, so an
 * interpolated string that came out with a double space (`Locks in ${label}`
 * with an empty label, say) yields words and not an empty span that eats an
 * index and animates nothing.
 */
export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** How many cascade slots a line of text occupies. */
export function wordCount(text: string): number {
  return splitWords(text).length;
}

/** The delay a piece at `index` in the cascade starts on. */
export function revealDelay(index: number): number {
  return index * BLUR_STEP_MS;
}

/**
 * Running offsets for a sequence of pieces, given how many slots each occupies:
 * `[4, 1, 1, 1, 2]` -> `[0, 4, 5, 6, 7]`.
 *
 * This is what makes a module built from several separate elements read as ONE
 * cascade instead of several that all start at zero. Each piece is handed the
 * index its first slot occupies in the whole sequence, and the pieces need not
 * know anything about each other.
 *
 * It has to be computed up front and passed down, NOT taken from a mutable
 * counter as each piece renders. In `PickHero` the eyebrow and the team name
 * are built inside child components, whose render runs after the parent has
 * already constructed its children — so call order and render order disagree,
 * and a counter would hand out indices in the wrong sequence.
 *
 * The last value is also the cascade's length: the final piece starts at
 * `starts.at(-1) * BLUR_STEP_MS` and ends 1250ms later. At ~29 pieces that is a
 * nominal ~2.4s, though `cubic-bezier(0.16,1,0.3,1)` puts roughly two thirds of
 * each piece's travel in its first fifth, so it reads far shorter. If it ever
 * drags, `BLUR_STEP_MS` is the one place to change.
 */
export function cascadeStarts(counts: number[]): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const count of counts) {
    starts.push(next);
    next += count;
  }
  return starts;
}

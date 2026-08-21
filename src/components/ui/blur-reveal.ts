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
 * cascade is this number against the duration below: a piece starts while its
 * predecessor is barely underway, so a module resolves as one wave rather than
 * as a queue of separate animations.
 *
 * It is also the main lever on a cascade's total length — see the note on
 * `cascadeStarts`. It was 40ms when the effect shipped, and the My Picks hero
 * at 29 pieces took 2.37s end to end, which read as slow. Halving it was the
 * larger half of the fix; `HERO_DURATION_MS` and revealing the hero's lock copy
 * per line rather than per word were the rest.
 */
export const BLUR_STEP_MS = 20;

/**
 * The DEFAULT duration, and the fallback baked into `tailwind.config.ts`'s
 * `blur-in` token: `animation: blur-in var(--blur-ms,1250ms) …`. A surface
 * re-paces every piece under it by setting that property on its own root —
 * `PickHero` does, with `[--blur-ms:650ms]`.
 *
 * Nothing reads this at runtime; the animation is entirely CSS. It is here
 * because the relationship between duration and step is what makes the effect a
 * wave, and because `settleMs` below is derived from it — so the tests beside
 * this file assert it rather than leaving a comment that can go stale.
 */
export const BLUR_DURATION_MS = 1250;

/**
 * The My Picks hero's pace, set on that module's root as `[--blur-ms:650ms]`.
 * It lives here beside the default it overrides, so the two are read together.
 *
 * The hero is a module you interact with — it re-forms on every team tap — and
 * a landing title is something you look at once. They want different speeds,
 * which is the whole reason the duration is a custom property rather than a
 * constant compiled into the token.
 */
export const HERO_DURATION_MS = 650;

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

// ── Sequencing whole blocks ──────────────────────────────────────────────────
//
// `cascadeStarts` above sequences pieces WITHIN one block, in slots. What
// follows sequences the blocks themselves, in milliseconds: the home page holds
// its title for a beat, and each block that follows waits for the one above it.

/**
 * The fraction of its duration at which a piece has visually landed.
 *
 * `blur-in` eases on `cubic-bezier(0.16, 1, 0.3, 1)`, which is violently
 * front-loaded: at t = 0.56 the piece is **98.3%** of the way there — a
 * remaining blur of 0.2px at an opacity of 0.98, which is to say finished to
 * anyone watching. The remaining 44% of the timeline is the curve's long tail.
 *
 * This is what "wait until the previous block is done" is measured from.
 * Against the formal end of the animation instead, the home page's four blocks
 * would take 7.7s to arrive and the standings table would be invisible for the
 * first 6.4s — a page that reads as broken rather than as paced.
 *
 * It also matches the frame captured while the effect was being built: at
 * 700ms — 0.56 of 1250ms — the hero already read as fully resolved.
 */
export const BLUR_SETTLE_FRACTION = 0.56;

/** The wait between one block landing and the next one starting. */
export const BLOCK_GAP_MS = 500;

/** When a piece starting now will have visually landed. */
export function settleMs(durationMs: number = BLUR_DURATION_MS): number {
  return Math.round(durationMs * BLUR_SETTLE_FRACTION);
}

/**
 * When each block in a sequence begins, in milliseconds, given how many pieces
 * each holds. A block starts `BLOCK_GAP_MS` after the previous block's LAST
 * piece has landed — not after its first, and not after the previous block's
 * animation formally ends (see `BLUR_SETTLE_FRACTION`).
 *
 * `firstStartMs` is the lead before anything moves. The home page holds 1s.
 *
 * `durationMs` is only needed by a surface that re-paces itself with
 * `--blur-ms`; every block in one sequence is assumed to share a duration,
 * which is true of the only caller and is what the property's inheritance
 * gives you anyway.
 */
export function blockStarts(
  counts: number[],
  firstStartMs = 0,
  durationMs: number = BLUR_DURATION_MS,
): number[] {
  const starts: number[] = [];
  let next = firstStartMs;
  for (const count of counts) {
    starts.push(next);
    const lastPiece = next + Math.max(0, count - 1) * BLUR_STEP_MS;
    next = lastPiece + settleMs(durationMs) + BLOCK_GAP_MS;
  }
  return starts;
}

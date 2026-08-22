/**
 * The arithmetic behind the pick surfaces' scroll reveal, kept out of the hook
 * so it unit-tests without a component-test stack — the same split
 * `week-strip.ts` and `team-grid.ts` make, and the repo's standing convention
 * (vitest runs in the Node environment; there is no jsdom and no
 * @testing-library here).
 *
 * WHEN a card reveals is one rule for both pick surfaces — its row crossing a
 * line near the bottom of the viewport, once, plus a replay on a week change.
 * WHAT it does when it gets there is two, and `REVEAL_VARIANTS` at the foot of
 * this file is where they sit side by side:
 *
 * - **clip** (`TeamGrid`, the 32 square team cards). A clip-path mask, not a
 *   fade: the card starts fully masked and wipes upward from its own bottom
 *   edge, like a curtain rising. The card never moves — only the mask changes —
 *   which is what keeps it clear of every piece of geometry in `TeamGrid` that
 *   is transcribed from the mockups.
 * - **fade** (`WeekSchedule`, the matchup cards). The fade+blur the My Picks
 *   hero resolves itself with, at the hero's own pace: this surface is asked to
 *   arrive the way the module above it does, so it borrows that module's
 *   numbers rather than inventing neighbouring ones.
 */

// Relative, not `@/…`. There is no vitest config in this repo, so vitest never
// reads tsconfig's `paths` — an aliased import here fails to resolve and takes
// `card-reveal.test.ts` down with it. Every unit-tested module in `src/` imports
// relatively for this reason; the six that use `@/` are all unreachable from a
// test. Verified by running the suite, not assumed.
import { HERO_DURATION_MS } from "../ui/blur-reveal";

// ── The clip variant ─────────────────────────────────────────────────────────

/** Fully masked: the whole card is clipped away from the top edge downward. */
export const REVEAL_HIDDEN = "inset(100% 0% 0% 0%)";

/**
 * Fully revealed. Deliberately `inset(0%)` rather than `none`: the tween has to
 * stay alive for ScrollTrigger's `reverse`, so this value stays on the element
 * as an inline style. It clips exactly at the border box, so the cards' rounded
 * corners and their `ring-inset` selected edge are all inside it and nothing is
 * cut.
 *
 * Written in the same four-value form as REVEAL_HIDDEN on purpose. Chrome's
 * *computed* clip-path collapses `inset(100% 0 0 0)` to the three-value
 * shorthand `inset(100% 0px 0px)`, and handing GSAP a start string with a
 * different token count than the end string is how string interpolation goes
 * wrong — hence a `fromTo` with both ends spelled out rather than a `to` that
 * reads the computed value.
 */
export const REVEAL_SHOWN = "inset(0% 0% 0% 0%)";

/** Seconds for one card's wipe, the first time it crosses the scroll line. */
export const REVEAL_DURATION = 1.2;

/**
 * The week-change replay is a quicker round trip than a first reveal: the cards
 * are already familiar and the point is to show the week turning over, not to
 * introduce them again. Exit shorter than entrance, the same trade `Drawer`
 * makes at 0.32s in / 0.28s out.
 */
export const REPLAY_OUT_DURATION = 0.35;
export const REPLAY_IN_DURATION = 0.6;

/**
 * The registered name of the eased curve. The curve is `cubic-bezier(0.4, 0,
 * 0.2, 1)`, registered once via CustomEase in `use-card-reveal.ts` — GSAP's
 * built-in `power2.inOut` is close but not the same curve.
 */
export const REVEAL_EASE = "pick-reveal";

// ── The fade variant ─────────────────────────────────────────────────────────
//
// Every value below is the My Picks hero's, because "reveal the matchup cards
// the way the pick module does" is the whole brief. The duration is IMPORTED
// rather than retyped so the two cannot drift; the other two are mirrored from
// `tailwind.config.ts`'s `blur-in` keyframe, with a test beside this file
// pinning them — the same convention `blur-reveal.test.ts` already uses for
// `BLUR_DURATION_MS`, and the best available answer while a keyframe is a
// config object that nothing at runtime can read.
//
// Called "fade" rather than "blur" throughout — the class, the constants, the
// ease — because `reveal-blur` is ALREADY a class in the same `@layer utilities`
// block, and it means very nearly the opposite: it is the declaration-less
// marker that switches the hero's `blur-in` OFF under reduced motion. Two names
// one word apart, in one file, doing opposite things, is a trap to walk into
// later.

/** The blurred, faded, slightly-oversized state a card starts in. */
export const FADE_BLUR_PX = 12;
export const FADE_SCALE = 1.04;

/**
 * Resolved. `blur(0px)`, and NOT `blur(0)` — which is how the keyframe this
 * mirrors spells it — and NOT `none`. All three are the same picture in CSS;
 * none of them are the same to GSAP, which has no filter parser and tweens the
 * string generically:
 *
 * - `none` has no numbers in it, so GSAP marks the property non-tweening and
 *   swaps `blur(12px)` straight to `none` on the FIRST tick. No blur at all.
 * - `blur(0)` parses the `0` but then measures the unit against the string's
 *   end and finds `)` in the way, so it never appends one: the midpoint renders
 *   `filter: blur(6)`, which is invalid, is dropped by the browser, and leaves
 *   the card sitting at `blur(12px)` until the last frame snaps it clear.
 *
 * The unit is what makes the trailing chunk `px)` instead of `)`. Test below
 * asserts the literal string, because asserting the number 0 cannot catch this.
 *
 * A settled card therefore keeps a filter and a transform inline for the life of
 * the page, and so keeps its own compositing layer. That is deliberate:
 * `blur-in` runs `fill-mode: both`, so every piece of the hero and every word of
 * the landing title already rest at `blur(0)` forever. A card quietly opting out
 * would be a difference to explain rather than an optimisation.
 */
export const FADE_HIDDEN_FILTER = `blur(${FADE_BLUR_PX}px)`;
export const FADE_SHOWN_FILTER = "blur(0px)";

/**
 * Seconds, from the hero's own `--blur-ms`. One pace for both the first reveal
 * and the week-change replay, where the clip variant runs 1.2s then 0.6s: the
 * hero re-forms on every team tap and does not speed up to do it, and matching
 * it is the point.
 */
export const FADE_DURATION = HERO_DURATION_MS / 1000;

/**
 * The exit is shorter than the entrance, as everywhere else in the app. It is
 * also, on the only surface that uses this variant, unreachable: `WeekSchedule`
 * keys its cards on `game.id`, which is globally unique per game, so a week
 * change mounts all-new nodes and `planCardReveal` always answers
 * `wipeOut: false`. It is here so the reveal is complete if it is ever pointed
 * at a surface that keeps its nodes across a week, as `TeamGrid` does.
 */
export const FADE_OUT_DURATION = 0.3;

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)` — the `blur-in` token's curve, registered
 * under this name in `use-card-reveal.ts`. Flatter in the tail than
 * `REVEAL_EASE` above, so a card is legible well before its animation formally
 * ends.
 */
export const FADE_EASE = "pick-fade";

// ── Shared by both reveals ───────────────────────────────────────────────────

/** Seconds between one card in a row and the next. */
export const REVEAL_STEP = 0.1;

/**
 * ScrollTrigger's start position: fire when the card's top reaches 100px above
 * the bottom of the viewport, so a row has begun revealing by the time it is
 * properly on screen rather than after.
 */
export const REVEAL_START = "top bottom-=100";

/**
 * One reveal, whole: the class its cards carry, the two ends it animates
 * between, three durations and a curve.
 *
 * A surface passes the WHOLE OBJECT to `useCardReveal` and reads `className` off
 * that same object, so the class on the card and the styles the hook writes come
 * from one import and cannot disagree. That is the point of the shape — a
 * `variant: "clip" | "blur"` string plus a lookup would typecheck perfectly
 * while naming the wrong class, and the consequence is not a wrong animation but
 * an invisible grid: the hook's `:scope > .…` query finds nothing, returns
 * before writing a single style, and every card sits at its CSS start state
 * forever. Silently, with typecheck and the suite still green. `WeekSchedule`
 * has carried a comment about that failure since there was only one way to
 * reach it.
 */
export interface Reveal {
  /** The card's start state in CSS, and the hook's query target. */
  readonly className: string;
  readonly hidden: Record<string, string | number>;
  readonly shown: Record<string, string | number>;
  /** Seconds: first reveal, week-change return, week-change exit. */
  readonly reveal: number;
  readonly replayIn: number;
  readonly replayOut: number;
  readonly ease: string;
}

/**
 * Assembled from the constants above rather than re-spelling their values, so
 * `TeamGrid`'s wipe is provably the animation it always was.
 */
export const REVEAL_CLIP: Reveal = {
  className: "reveal-clip",
  hidden: { clipPath: REVEAL_HIDDEN },
  shown: { clipPath: REVEAL_SHOWN },
  reveal: REVEAL_DURATION,
  replayIn: REPLAY_IN_DURATION,
  replayOut: REPLAY_OUT_DURATION,
  ease: REVEAL_EASE,
};

/**
 * `pointerEvents` is in `shown` and has no counterpart in `hidden`, and that
 * asymmetry is the whole of it: `.reveal-fade` carries `pointer-events: none` in
 * CSS, and this is what gives it back.
 *
 * It is not tidiness. A `clip-path`-masked card is not hit-testable — clipped
 * regions do not receive pointer events — so the clip reveal got this for free
 * and nobody had to think about it. An `opacity: 0` card is fully live: its
 * radio inputs stay focusable and checkable while it is invisible. In a league
 * where you get one pick a week and spend a team by making it, a tap that lands
 * on a card nobody can see is not a cosmetic bug. The case that actually bites
 * is the one CLAUDE.md already names for `.reveal-clip` — if the client JS never
 * loads, the grid renders blank; blank and inert is survivable, blank and live
 * is not.
 *
 * GSAP marks a value with no numbers in it non-tweening and applies it on the
 * first tick rather than the last, so the card becomes clickable as it starts
 * arriving rather than 650ms later. That is the behaviour wanted, and it is free.
 */
export const REVEAL_FADE: Reveal = {
  className: "reveal-fade",
  hidden: { opacity: 0, filter: FADE_HIDDEN_FILTER, scale: FADE_SCALE },
  shown: { opacity: 1, filter: FADE_SHOWN_FILTER, scale: 1, pointerEvents: "auto" },
  reveal: FADE_DURATION,
  replayIn: FADE_DURATION,
  replayOut: FADE_OUT_DURATION,
  ease: FADE_EASE,
};

/**
 * How many columns a grid is actually drawing, read from its *computed*
 * `grid-template-columns`. Returns 0 when the value can't be counted.
 *
 * Reading the live value rather than hardcoding a number is the whole point.
 * Neither pick surface has a fixed column count: `TeamGrid` steps 3 -> 4 -> 5
 * -> 6 across `min-[480px]`, `md` and `lg`, and `WeekSchedule` is
 * `repeat(auto-fill, minmax(260px, 1fr))`, whose count is content-driven and so
 * cannot be derived from breakpoints at all. A hardcoded modulus would only
 * coincide with real rows at one width, and everywhere else the cascade would
 * drift diagonally across rows instead of resetting at each one.
 *
 * The computed value is not the authored value, and the two ways that bites are
 * both handled here:
 *
 * - Line names come back as bracketed groups *between* the tracks
 *   (`[full-start] 100px [main] 100px`). They are not tracks.
 * - A `repeat()` can come back verbatim rather than resolved, and its internal
 *   comma splits into two plausible-looking "tracks" — which is worse than not
 *   answering, because 2 is a number the caller would trust. Any surviving
 *   parenthesis therefore means "unreadable", and `countColumnsByRow` takes
 *   over.
 *
 * That last case is not hypothetical or limited to unrendered elements.
 * `WeekSchedule`'s grid element is its `<fieldset>`, and a fieldset's grid
 * formatting context lives on its anonymous content box — Chrome reports
 * `repeat(auto-fill, minmax(260px, 1fr))` back off the fieldset at every width,
 * fully laid out, with the cards visibly in three columns behind it. Measured,
 * not assumed.
 */
export function columnCountFrom(value: string): number {
  const tracks = value.replace(/\[[^\]]*\]/g, " ").trim();
  if (!tracks || tracks === "none") return 0;
  if (tracks.includes("(")) return 0;
  return tracks.split(/\s+/).length;
}

/**
 * The same count, taken from where the cards actually ARE: how many of them
 * share the first one's top edge.
 *
 * This is the answer whenever `columnCountFrom` declines, and between them the
 * hook is correct on any grid rather than only on ones that report their tracks.
 *
 * It stops at the first row rather than counting every matching top, because a
 * later row can land on the same coordinate once the page scrolls, and
 * `tops[0]` is only meaningful as the start of a run. The tolerance absorbs
 * sub-pixel track rounding — a real three-column row measures as
 * `120.656 / 120.672 / 120.656`, not three identical numbers.
 *
 * It is also immune to the thing that makes the computed read awkward at mount:
 * `.stagger`'s entrance transform moves every card by the same 12px, so tops
 * relative to each other are unaffected.
 *
 * Never returns 0 — that would make `index % columns` NaN, which does not throw
 * and would silently delete the stagger instead.
 */
export function countColumnsByRow(tops: readonly number[], tolerance = 1): number {
  const first = tops[0];
  if (first === undefined) return 1;
  let count = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > tolerance) break;
    count += 1;
  }
  return count > 0 ? count : 1;
}

/**
 * How long the card at `index` waits before it wipes.
 *
 * The modulus is what makes this a per-ROW cascade rather than a per-GRID one.
 * Cards in the same row sit at the same vertical position and so cross the
 * trigger line at the same scroll moment; the left-to-right feel comes entirely
 * from this delay. Resetting it at the start of every row keeps each row's
 * cascade to `REVEAL_STEP * columns` — instead of the delay growing without
 * bound down the grid, which by the 32nd card would be a three-second wait for
 * a card already on screen.
 *
 * `columns` is floored at 1 so an unreadable `columnCountFrom` (which answers 0)
 * degrades to "the row reveals together" rather than dividing by zero. The
 * result is rounded because `3 * 0.1` is not 0.3 in binary floating point, and
 * a timeline position is nicer to read — and to assert on — without the tail.
 */
export function revealDelay(index: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns));
  const at = Math.max(0, Math.floor(index));
  return Math.round((at % cols) * REVEAL_STEP * 1000) / 1000;
}

/**
 * What to do with one card on a given build.
 *
 * `replay` carries `wipeOut` rather than always wiping, because there is not
 * always something on screen to wipe away — see `planCardReveal`.
 */
export type CardPlan =
  | { kind: "replay"; wipeOut: boolean }
  | { kind: "hold" }
  | { kind: "arm" };

/**
 * Which of the three things happens to a card when the reveal (re)builds.
 *
 * The reveal is ONE-WAY: a card wipes in the first time its row crosses the
 * trigger line and then stays. Scrolling back up and down again must not replay
 * it. The single exception is a week change, which is the one moment the grid is
 * saying something new and should animate to say it — every card on screen wipes
 * away and back, the first row included.
 *
 * The asymmetry in the rules below is the load-bearing part. **A week change
 * keys on POSITION; every other rebuild keys on REVEALED-NESS.** They used to be
 * the same test, because while the reveal reversed on scroll-up, "above the
 * line" and "has been revealed" were the same fact. They no longer are: a card
 * revealed on the way down and then scrolled back below the line is still
 * revealed, so a positional test would re-mask it on the next sort toggle.
 *
 * Taken in order:
 *
 * - **Week changed, and the card is above the line.** Replay it. `wipeOut` is
 *   whether it was actually showing — `TeamGrid` keeps its 32 labels across a
 *   week (`key={teamId}`) so they were, but `WeekSchedule` keys on `game.id`,
 *   which is globally unique per game, so every card there is a node mounted a
 *   moment ago with nothing to wipe away. Those just wipe in.
 * - **Week changed, and the card is below the line.** Arm it. It is out of
 *   sight, so it gets the ordinary scroll reveal on the way down, exactly as on
 *   a fresh load.
 * - **Anything else, and it was revealed.** Hold: put it back and animate
 *   nothing. This is a sort toggle or a breakpoint crossing, and revealed is
 *   terminal.
 * - **Otherwise.** Arm it and wait for the line.
 */
export function planCardReveal(input: {
  weekChanged: boolean;
  wasRevealed: boolean;
  aboveLine: boolean;
}): CardPlan {
  if (input.weekChanged) {
    return input.aboveLine ? { kind: "replay", wipeOut: input.wasRevealed } : { kind: "arm" };
  }
  return input.wasRevealed ? { kind: "hold" } : { kind: "arm" };
}
